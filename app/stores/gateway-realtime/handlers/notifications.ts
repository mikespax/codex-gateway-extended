import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import type {
  RealtimeHandlers,
  RealtimeServerMessageHandlerContext,
  RealtimeServerMessageMap,
} from "./types";

export function createNotificationRealtimeHandlers(ctx: RealtimeServerMessageHandlerContext) {
  return {
    "notification.published": ({ notification }) => {
      gatewayDomainEvents.emit("realtime-notification-published", {
        notification,
        actionLabel: ctx.t(notificationActionLabelKey(notification)),
      });
    },
    "host.lifecycle": (message) => gatewayDomainEvents.emit("realtime-host-lifecycle", message),
  } satisfies RealtimeHandlers;
}

function notificationActionLabelKey(
  notification: RealtimeServerMessageMap["notification.published"]["notification"],
) {
  return notification.target.kind === "thread" ? "app.openThread" : "app.openTmuxMonitor";
}
