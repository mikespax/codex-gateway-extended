import type { Message, Peer } from "crossws";
import { browserPreviewManager } from "./browser-preview-manager";
import { readPreviewCookie } from "./browser-preview-proxy";
import { browserPreviewUpstreamConnector } from "./browser-preview-upstream-connector";
import { BrowserPreviewWebSocketBridge } from "./browser-preview-websocket-bridge";

interface BrowserPreviewPeerContext {
  bridge?: BrowserPreviewWebSocketBridge;
}

const previewPeerContexts = new WeakMap<Peer, BrowserPreviewPeerContext>();

export async function openBrowserPreviewWebSocket(peer: Peer) {
  const request = peer.request;
  const requestUrl = browserPreviewWebSocketUrl(request);
  const hostname = requestUrl.hostname.toLowerCase();
  const session = browserPreviewManager.resolveWebSocket(
    hostname,
    readPreviewCookie(request.headers.get("cookie") ?? undefined),
  );
  if (session === null) {
    peer.close(1008, "Browser preview session expired");
    return;
  }

  console.info("[browser-preview] websocket opening", {
    sessionId: session.sessionId,
    target: session.target.origin,
    path: requestUrl.pathname,
  });

  const protocols = request.headers
    .get("sec-websocket-protocol")
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const context = previewPeerContext(peer);
  context.bridge?.closeFromPeer();
  context.bridge = new BrowserPreviewWebSocketBridge({
    peer,
    connectUpstream: async () => {
      const upstream = await browserPreviewUpstreamConnector.openWebSocket(
        session,
        `${requestUrl.pathname}${requestUrl.search}`,
        protocols,
        websocketHeaders(session.target.origin, request.headers),
      );
      upstream.once("open", () => {
        console.info("[browser-preview] websocket upstream connected", {
          sessionId: session.sessionId,
        });
      });
      return upstream;
    },
    onBridgeError: (error) => {
      console.error("[browser-preview] websocket bridge failed", {
        sessionId: session.sessionId,
        message: error.message,
      });
    },
  });
  context.bridge.open();
}

export function browserPreviewWebSocketUrl(request: { url: string; headers: Headers }) {
  const headerHost = request.headers.get("host") ?? "preview.invalid";
  const requestUrl = new URL(request.url, `http://${headerHost}`);
  const forwardedPath =
    request.headers.get("x-browser-preview-path") ?? requestUrl.searchParams.get("path");
  return forwardedPath === null || forwardedPath === ""
    ? requestUrl
    : new URL(forwardedPath, `http://${headerHost}`);
}

export function forwardBrowserPreviewWebSocketMessage(peer: Peer, message: Message) {
  previewPeerContext(peer).bridge?.sendFromPeer(message);
}

export function closeBrowserPreviewWebSocket(peer: Peer) {
  const context = previewPeerContext(peer);
  context.bridge?.closeFromPeer();
  context.bridge = undefined;
}

function previewPeerContext(peer: Peer) {
  let context = previewPeerContexts.get(peer);
  if (context === undefined) {
    context = {};
    previewPeerContexts.set(peer, context);
  }
  return context;
}

function websocketHeaders(targetOrigin: string, incoming: Headers) {
  const headers: Record<string, string> = {};
  const cookie = incoming
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .filter((value) => !/^(__Host-)?gateway-preview=/.test(value))
    .join("; ");
  if (cookie !== undefined && cookie !== "") headers.cookie = cookie;
  headers.origin = targetOrigin;
  const userAgent = incoming.get("user-agent");
  if (userAgent !== null && userAgent !== "") headers["user-agent"] = userAgent;
  return headers;
}
