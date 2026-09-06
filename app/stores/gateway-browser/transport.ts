import type { BrowserPreviewTarget } from "~~/shared/types";
import { useGatewayBrowserStore } from "./index";
import { useGatewayRealtimeStore } from "../gateway-realtime";
import { expectBrowserOpened } from "../gateway-realtime/response-parsers";

export async function openBrowserPreview(input: BrowserPreviewTarget) {
  // Browser panels also carry UI-only fields such as `title`. TypeScript's structural typing
  // permits those objects at this call site, so project the official wire target explicitly.
  // Do not loosen the realtime parser: strict protocol boundaries are what catch accidental UI
  // state leakage before it reaches the server.
  const target = browserPreviewWireTarget(input);
  const response = await useGatewayRealtimeStore().request(
    (requestId) => ({ type: "browser.open", requestId, ...target }),
    expectBrowserOpened,
    { timeoutMs: 30_000 },
  );
  // browser.opened is projected into Pinia by the realtime domain subscriber before the request
  // broker resolves this promise. Writing the same session here as well recreates a declarative
  // iframe src during its one-time ticket exchange, so keep one event-owned state boundary.
  return response.session;
}

function browserPreviewWireTarget(input: BrowserPreviewTarget): BrowserPreviewTarget {
  return {
    hostId: input.hostId,
    projectId: input.projectId,
    threadId: input.threadId,
    panelId: input.panelId,
    targetUrl: input.targetUrl,
    allowInsecureTls: input.allowInsecureTls,
  };
}

export async function closeBrowserPreview(sessionId: string) {
  useGatewayBrowserStore().removeSession(sessionId);
  await useGatewayRealtimeStore()
    .request((requestId) => ({ type: "browser.close", requestId, sessionId }))
    .catch(() => null);
}

export async function setBrowserPreviewInsecureTls(sessionId: string, allowInsecureTls: boolean) {
  const response = await useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "browser.allowInsecureTls",
      requestId,
      sessionId,
      allowInsecureTls,
    }),
    expectBrowserOpened,
  );
  return response.session;
}
