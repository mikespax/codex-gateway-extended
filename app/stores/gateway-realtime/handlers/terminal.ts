import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import type { RealtimeHandlers, RealtimeServerMessageHandlerContext } from "./types";

export function createTerminalRealtimeHandlers(ctx: RealtimeServerMessageHandlerContext) {
  return {
    "terminal.opened": (message) => {
      gatewayDomainEvents.emit("realtime-terminal-opened", { session: message.session });
      ctx.resolveRequest(message);
    },
    "terminal.snapshot": (message) => {
      gatewayDomainEvents.emit("realtime-terminal-snapshot", { sessions: message.sessions });
      ctx.resolveRequest(message);
    },
    "terminal.closed": (message) => {
      gatewayDomainEvents.emit("realtime-terminal-closed", { sessionId: message.sessionId });
      ctx.resolveRequest(message);
    },
    "terminal.closed.event": ({ sessionId }) =>
      gatewayDomainEvents.emit("realtime-terminal-closed", { sessionId }),
    "terminal.output": ({ sessionId, data }) =>
      gatewayDomainEvents.emit("realtime-terminal-output", { sessionId, data }),
    "terminal.exited": ({ sessionId }) =>
      gatewayDomainEvents.emit("realtime-terminal-exited", {
        sessionId,
        displayMessage: ctx.t("app.terminalExited"),
      }),
    "terminal.error": (message) => {
      if (message.requestId !== undefined && message.requestId !== "") {
        ctx.rejectRequest(message.requestId, new Error(message.message));
      }
      gatewayDomainEvents.emit("realtime-terminal-error", {
        sessionId: message.sessionId,
        message: message.message,
      });
    },
  } satisfies RealtimeHandlers;
}
