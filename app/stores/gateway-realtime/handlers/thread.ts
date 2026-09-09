import type { GatewayEvent } from "~~/shared/types";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import type {
  RealtimeHandlers,
  RealtimeServerMessageHandlerContext,
  RealtimeServerMessageMap,
} from "./types";

export function createThreadRealtimeHandlers(ctx: RealtimeServerMessageHandlerContext) {
  return {
    "thread.event": ({ event }) => handleThreadEvent(ctx, event),
    "thread.runtime.snapshot": ({ statuses }) => {
      for (const update of statuses) projectThreadRuntimeStatus(update);
    },
    "thread.runtime.updated": ({ update }) => projectThreadRuntimeStatus(update),
    "thread.events.gap": ({ hostId, threadId }) =>
      gatewayDomainEvents.emit("realtime-thread-events-gap", { hostId, threadId }),
    "thread.goal.updated": (message) => {
      gatewayDomainEvents.emit("realtime-thread-goal-updated", message);
      ctx.resolveRequest(message);
    },
    "thread.goal.cleared": (message) => {
      gatewayDomainEvents.emit("realtime-thread-goal-cleared", message);
      ctx.resolveRequest(message);
    },
    "thread.goal.snapshot": (message) => {
      gatewayDomainEvents.emit("realtime-thread-goal-snapshot", message);
      ctx.resolveRequest(message);
    },
  } satisfies RealtimeHandlers;
}

function projectThreadRuntimeStatus(
  update: RealtimeServerMessageMap["thread.runtime.updated"]["update"],
) {
  gatewayDomainEvents.emit("thread-status-detected", update);
  if (update.currentOperation !== undefined) {
    const activity = useGatewayThreadActivityStore();
    activity.updateCurrentOperation(update.hostId, update.threadId, update.currentOperation);
  }
}

function handleThreadEvent(ctx: RealtimeServerMessageHandlerContext, event: GatewayEvent) {
  gatewayDomainEvents.emit("realtime-thread-event", { event });
  ctx.advanceThreadSubscriptionCursor(event);
}
