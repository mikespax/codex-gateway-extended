import type { Message, Peer } from "crossws";
import WebSocket, { type RawData } from "ws";
import ensureError from "ensure-error";
import {
  BROWSER_PREVIEW_MAX_WEBSOCKET_BUFFERED_BYTES,
  BROWSER_PREVIEW_MAX_WEBSOCKET_PENDING_BYTES,
  BROWSER_PREVIEW_MAX_WEBSOCKET_PENDING_MESSAGES,
  BROWSER_PREVIEW_PEER_DRAIN_THRESHOLD_BYTES,
  BROWSER_PREVIEW_WEBSOCKET_CONNECT_TIMEOUT_MS,
} from "./browser-preview-websocket-limits";

type BrowserPreviewFrame = string | Uint8Array;

interface BrowserPreviewWebSocketBridgeOptions {
  peer: Peer;
  connectUpstream: () => Promise<WebSocket>;
  onBridgeError: (error: Error) => void;
}

/**
 * Bridges the two standard WebSocket implementations without adding another protocol. crossws
 * exposes the browser-side WebSocket through peer.websocket, while ws exposes bufferedAmount
 * directly. The bounded queues only cover periods where either endpoint cannot currently accept
 * data.
 */
export class BrowserPreviewWebSocketBridge {
  private upstream: WebSocket | undefined;
  private readonly queuedToUpstream = new BoundedFrameQueue();
  private readonly queuedToPeer = new BoundedFrameQueue();
  private connectTimeout: NodeJS.Timeout | undefined;
  private peerDrainTask: Promise<void> | undefined;
  private readonly peerDrainAbort = new AbortController();
  private closed = false;

  constructor(private readonly options: BrowserPreviewWebSocketBridgeOptions) {}

  open() {
    this.connectTimeout = setTimeout(() => {
      this.fail(1011, "Remote WebSocket connection timed out");
    }, BROWSER_PREVIEW_WEBSOCKET_CONNECT_TIMEOUT_MS);
    void this.connect();
  }

  sendFromPeer(message: Message) {
    if (this.closed) return;
    const frame = frameFromMessage(message);
    if (this.upstream?.readyState === WebSocket.OPEN) {
      this.sendToUpstream(frame);
      return;
    }
    if (!this.queuedToUpstream.push(frame)) {
      this.fail(1009, "Remote WebSocket connection buffer limit exceeded");
    }
  }

  closeFromPeer() {
    this.close();
  }

  private async connect() {
    try {
      const upstream = await this.options.connectUpstream();
      if (this.closed) {
        upstream.close();
        return;
      }
      this.upstream = upstream;
      this.bindUpstream(upstream);
    } catch (error) {
      this.options.onBridgeError(ensureError(error));
      this.fail(1011, "Remote WebSocket failed");
    }
  }

  private bindUpstream(upstream: WebSocket) {
    upstream.on("open", () => {
      if (this.upstream !== upstream || this.closed) return;
      this.clearConnectTimeout();
      for (const frame of this.queuedToUpstream.drain()) this.sendToUpstream(frame);
    });
    upstream.on("message", (data: RawData, isBinary) => {
      if (this.upstream !== upstream || this.closed) return;
      this.sendToPeer(isBinary ? binaryFrame(data) : textFrame(data));
    });
    upstream.on("close", (code, reason) => {
      if (this.upstream !== upstream || this.closed) return;
      this.close(peerCloseCode(code), reason.toString());
    });
    upstream.on("error", (error) => {
      if (this.upstream !== upstream || this.closed) return;
      this.options.onBridgeError(error);
      this.fail(1011, "Remote WebSocket failed");
    });
  }

  private sendToUpstream(frame: BrowserPreviewFrame) {
    const upstream = this.upstream;
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
    if (
      upstream.bufferedAmount + frameByteLength(frame) >
      BROWSER_PREVIEW_MAX_WEBSOCKET_BUFFERED_BYTES
    ) {
      this.fail(1009, "Remote WebSocket buffer limit exceeded");
      return;
    }
    try {
      upstream.send(frame, (error) => {
        if (error && !this.closed) {
          this.options.onBridgeError(error);
          this.fail(1011, "Remote WebSocket failed");
        }
      });
    } catch (error) {
      this.options.onBridgeError(ensureError(error));
      this.fail(1011, "Remote WebSocket failed");
    }
  }

  private sendToPeer(frame: BrowserPreviewFrame) {
    if (
      this.queuedToPeer.size ||
      peerBufferedAmount(this.options.peer) > BROWSER_PREVIEW_PEER_DRAIN_THRESHOLD_BYTES
    ) {
      if (!this.queuedToPeer.push(frame)) {
        this.fail(1009, "Browser WebSocket buffer limit exceeded");
        return;
      }
      this.schedulePeerDrain();
      return;
    }
    this.safeSendToPeer(frame);
  }

  private schedulePeerDrain() {
    this.peerDrainTask ??= this.drainPeerQueue().finally(() => {
      this.peerDrainTask = undefined;
      if (!this.closed && this.queuedToPeer.size) this.schedulePeerDrain();
    });
  }

  private async drainPeerQueue() {
    while (!this.closed && this.queuedToPeer.size) {
      if (peerBufferedAmount(this.options.peer) > BROWSER_PREVIEW_PEER_DRAIN_THRESHOLD_BYTES) {
        await waitForPeerDrain(
          this.options.peer,
          BROWSER_PREVIEW_PEER_DRAIN_THRESHOLD_BYTES,
          this.peerDrainAbort.signal,
        );
        if (this.peerDrainAbort.signal.aborted) return;
      }
      const frame = this.queuedToPeer.shift();
      if (frame !== undefined) this.safeSendToPeer(frame);
    }
  }

  private safeSendToPeer(frame: BrowserPreviewFrame) {
    if (
      peerBufferedAmount(this.options.peer) + frameByteLength(frame) >
      BROWSER_PREVIEW_MAX_WEBSOCKET_BUFFERED_BYTES
    ) {
      this.fail(1009, "Browser WebSocket buffer limit exceeded");
      return;
    }
    try {
      this.options.peer.send(frame);
    } catch (error) {
      this.options.onBridgeError(ensureError(error));
      this.fail(1011, "Browser WebSocket failed");
    }
  }

  private fail(code: number, reason: string) {
    this.close(code, reason);
  }

  private close(code?: number, reason?: string) {
    if (this.closed) return;
    this.closed = true;
    this.clearConnectTimeout();
    this.peerDrainAbort.abort();
    this.queuedToUpstream.clear();
    this.queuedToPeer.clear();
    const upstream = this.upstream;
    this.upstream = undefined;
    if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close(code, reason);
    if (code !== undefined) this.options.peer.close(code, reason);
  }

  private clearConnectTimeout() {
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.connectTimeout = undefined;
  }
}

class BoundedFrameQueue {
  private frames: BrowserPreviewFrame[] = [];
  private bytes = 0;

  get size() {
    return this.frames.length;
  }

  push(frame: BrowserPreviewFrame) {
    const bytes = frameByteLength(frame);
    if (
      this.frames.length >= BROWSER_PREVIEW_MAX_WEBSOCKET_PENDING_MESSAGES ||
      this.bytes + bytes > BROWSER_PREVIEW_MAX_WEBSOCKET_PENDING_BYTES
    ) {
      return false;
    }
    this.frames.push(frame);
    this.bytes += bytes;
    return true;
  }

  shift() {
    const frame = this.frames.shift();
    if (frame !== undefined) this.bytes -= frameByteLength(frame);
    return frame;
  }

  drain() {
    const frames = this.frames;
    this.frames = [];
    this.bytes = 0;
    return frames;
  }

  clear() {
    this.frames = [];
    this.bytes = 0;
  }
}

function frameFromMessage(message: Message): BrowserPreviewFrame {
  return typeof message.rawData === "string" ? message.rawData : message.uint8Array();
}

function binaryFrame(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

function textFrame(data: RawData) {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function frameByteLength(frame: BrowserPreviewFrame) {
  return typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
}

function peerBufferedAmount(peer: Peer) {
  return peer.websocket.bufferedAmount ?? 0;
}

/**
 * crossws 0.3.x does not expose the waitForDrain helper available in newer adapters. Poll the
 * standard WebSocket bufferedAmount instead, while retaining cancellation when the bridge closes.
 */
async function waitForPeerDrain(peer: Peer, threshold: number, signal: AbortSignal) {
  while (!signal.aborted && peerBufferedAmount(peer) > threshold) {
    await new Promise<void>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      timeout = setTimeout(finish, 50);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}

function peerCloseCode(code: number) {
  return code === 1006 || code === 1015 ? 1011 : code === 1005 ? 1000 : code;
}
