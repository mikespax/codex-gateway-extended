import type { Page } from "@playwright/test";

interface RealtimeSocketProbe {
  closeCalls: Array<{ code?: number; reason?: string }>;
  messages: Array<Record<string, unknown>>;
  sockets: Set<WebSocket>;
}

declare global {
  interface Window {
    __gatewayRealtimeProbe?: RealtimeSocketProbe;
  }
}

export async function installRealtimeSocketProbe(page: Page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    const probe: RealtimeSocketProbe = {
      closeCalls: [],
      messages: [],
      sockets: new Set<WebSocket>(),
    };

    class TrackedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(String(url), window.location.href).pathname !== "/api/realtime") {
          return;
        }
        probe.sockets.add(this);
        this.addEventListener("close", () => probe.sockets.delete(this));
      }

      override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === "string") {
          try {
            const message: unknown = JSON.parse(data);
            if (
              message !== null &&
              typeof message === "object" &&
              "type" in message &&
              typeof message.type === "string"
            ) {
              probe.messages.push(message);
            }
          } catch {
            // Binary and non-protocol frames are irrelevant to these assertions.
          }
        }
        if (typeof data === "string" || data instanceof Blob) {
          super.send(data);
          return;
        }
        const source = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        const frame = new Uint8Array(source.byteLength);
        frame.set(source);
        super.send(frame);
      }

      override close(code?: number, reason?: string) {
        probe.closeCalls.push({ code, reason });
        super.close(code, reason);
      }
    }

    window.WebSocket = TrackedWebSocket;
    window.__gatewayRealtimeProbe = probe;
  });
}

export async function activeRealtimeSocketCount(page: Page) {
  return page.evaluate(() => window.__gatewayRealtimeProbe?.sockets.size ?? 0);
}

export async function activeRealtimeSocketUrls(page: Page) {
  return page.evaluate(() =>
    [...(window.__gatewayRealtimeProbe?.sockets ?? [])].map((socket) => socket.url),
  );
}

export async function realtimeSocketCloseCalls(page: Page) {
  return page.evaluate(() => [...(window.__gatewayRealtimeProbe?.closeCalls ?? [])]);
}

export async function closeRealtimeSockets(page: Page) {
  await page.evaluate(() => {
    for (const socket of window.__gatewayRealtimeProbe?.sockets ?? []) {
      socket.close();
    }
  });
}

export async function dispatchRealtimeServerFrame(page: Page, raw: string) {
  await page.evaluate((frame) => {
    const socket = [...(window.__gatewayRealtimeProbe?.sockets ?? [])][0];
    if (socket === undefined) throw new Error("No realtime WebSocket connection is open");
    // Dispatch through the native EventTarget API so the production message listener receives the
    // exact frame while close/reconnect still uses the real browser WebSocket lifecycle.
    socket.dispatchEvent(new MessageEvent("message", { data: frame }));
  }, raw);
}

export async function realtimeClientMessageCount(page: Page) {
  return page.evaluate(() => window.__gatewayRealtimeProbe?.messages.length ?? 0);
}

export async function waitForRealtimeClientMessage(page: Page, type: string, offset: number) {
  try {
    await page.waitForFunction(
      ({ expectedType, startIndex }) =>
        (window.__gatewayRealtimeProbe?.messages ?? [])
          .slice(startIndex)
          .some((message) => message.type === expectedType),
      { expectedType: type, startIndex: offset },
      { timeout: 30_000 },
    );
  } catch (error) {
    const messages = await page.evaluate(
      (startIndex) => (window.__gatewayRealtimeProbe?.messages ?? []).slice(startIndex),
      offset,
    );
    throw new Error(
      [
        `Timed out waiting for realtime client message ${type}`,
        `Observed messages after offset ${offset}:`,
        JSON.stringify(messages, null, 2),
      ].join("\n"),
      { cause: error },
    );
  }
  const message = await page.evaluate(
    ({ expectedType, startIndex }) =>
      (window.__gatewayRealtimeProbe?.messages ?? [])
        .slice(startIndex)
        .find((message) => message.type === expectedType),
    { expectedType: type, startIndex: offset },
  );
  if (!message) {
    throw new Error(`Realtime probe lost message ${type} after it was observed`);
  }
  return message;
}
