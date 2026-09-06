import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import type { RealtimeHandlers, RealtimeServerMessageHandlerContext } from "./types";

export function createBrowserRealtimeHandlers(ctx: RealtimeServerMessageHandlerContext) {
  return {
    "browser.opened": (message) => {
      gatewayDomainEvents.emit("realtime-browser-opened", { session: message.session });
      ctx.resolveRequest(message);
    },
    "browser.closed": (message) => {
      gatewayDomainEvents.emit("realtime-browser-closed", { sessionId: message.sessionId });
      ctx.resolveRequest(message);
    },
    "browser.error": (message) => {
      if (message.requestId !== undefined && message.requestId !== "") {
        ctx.rejectRequest(message.requestId, new Error(message.message));
      }
      gatewayDomainEvents.emit("realtime-browser-error", { message: message.message });
    },
    "browser.framePolicyWarning": ({ sessionId, value }) =>
      gatewayDomainEvents.emit("realtime-browser-frame-warning", { sessionId, value }),
    "browser.resourceFailed": ({ sessionId, failure }) =>
      gatewayDomainEvents.emit("realtime-browser-resource-failed", { sessionId, failure }),
  } satisfies RealtimeHandlers;
}
