import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import type { RealtimeHandlers, RealtimeServerMessageHandlerContext } from "./types";

export function createTmuxSessionsRealtimeHandlers(ctx: RealtimeServerMessageHandlerContext) {
  return {
    "tmux.sessions.snapshot": (message) => {
      gatewayDomainEvents.emit("realtime-tmux-sessions", message);
      ctx.resolveRequest(message);
    },
    "tmux.sessions.updated": (message) =>
      gatewayDomainEvents.emit("realtime-tmux-sessions", message),
  } satisfies RealtimeHandlers;
}
