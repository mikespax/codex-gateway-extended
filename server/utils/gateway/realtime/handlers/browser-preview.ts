import type { BrowserPreviewTarget, RealtimeClientMessage } from "~~/shared/types";
import { browserPreviewEvents } from "../../browser-preview/browser-preview-events";
import { browserPreviewManager } from "../../browser-preview/browser-preview-manager";
import { hostStore } from "../../state/hosts";
import {
  authenticatedUserId,
  runPeerScoped,
  sendRealtimePeerMessage,
  stateFor,
  type RealtimePeer,
} from "../peer-state";
import { runtimeLog } from "../../runtime/runtime-log";

export function openBrowserPreview(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "browser.open" }>,
) {
  const state = stateFor(peer);
  const host = runPeerScoped(peer, () => hostStore.getWithSecret(request.hostId));
  if (!host) throw new Error(`Host ${request.hostId} is unavailable`);
  const session = browserPreviewManager.open(
    requireOwnerId(state.browserOwnerId),
    authenticatedUserId(peer),
    host,
    browserPreviewTarget(request),
  );
  runtimeLog("browser preview session opened", {
    hostId: host.id,
    hostName: host.name,
    sessionId: session.sessionId,
    panelId: request.panelId,
    targetOrigin: new URL(session.targetUrl).origin,
  });
  sendRealtimePeerMessage(peer, { type: "browser.opened", requestId: request.requestId, session });
}

function browserPreviewTarget(
  request: Extract<RealtimeClientMessage, { type: "browser.open" }>,
): BrowserPreviewTarget {
  // The request also owns `type` and `requestId`. Persisting it through structural typing leaks
  // those transport fields into browser.opened.session, which the strict client schema must reject.
  return {
    hostId: request.hostId,
    projectId: request.projectId,
    threadId: request.threadId,
    panelId: request.panelId,
    targetUrl: request.targetUrl,
    allowInsecureTls: request.allowInsecureTls,
  };
}

export function closeBrowserPreview(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "browser.close" }>,
) {
  browserPreviewManager.close(authenticatedUserId(peer), request.sessionId);
  sendRealtimePeerMessage(peer, {
    type: "browser.closed",
    requestId: request.requestId,
    sessionId: request.sessionId,
  });
}

export function allowInsecureBrowserPreviewTls(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "browser.allowInsecureTls" }>,
) {
  const session = browserPreviewManager.setInsecureTls(
    authenticatedUserId(peer),
    request.sessionId,
    request.allowInsecureTls,
  );
  sendRealtimePeerMessage(peer, { type: "browser.opened", requestId: request.requestId, session });
}

export function subscribeBrowserPreviewEvents(peer: RealtimePeer) {
  const state = stateFor(peer);
  state.browserPreviewUnsubscribe?.();
  state.browserPreviewUnsubscribe = browserPreviewEvents.subscribe(
    authenticatedUserId(peer),
    (event) => {
      if (event.type === "frame-policy") {
        sendRealtimePeerMessage(peer, {
          type: "browser.framePolicyWarning",
          sessionId: event.sessionId,
          policy: event.policy,
          value: event.value,
        });
        return;
      }
      sendRealtimePeerMessage(peer, {
        type: "browser.resourceFailed",
        sessionId: event.sessionId,
        failure: event.failure,
      });
    },
  );
}

function requireOwnerId(ownerId: string | undefined) {
  if (ownerId === undefined || ownerId === "") {
    throw new Error("Browser preview owner is unavailable");
  }
  return ownerId;
}
