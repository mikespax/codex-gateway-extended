import { deliverBarkNotification } from "./bark-delivery";
import { deliverAndroidNotification } from "./android-delivery";
import { notificationRealtimeEvents } from "./notification-realtime-events";
import type { ServerNotification } from "~~/shared/types";
import { gatewayMemoryState } from "../state/memory";

const MAX_PUBLISHED_NOTIFICATION_KEYS = 1_000;

export const notificationCenter = {
  async publish(notification: ServerNotification) {
    if (!alreadyPublished(notification.key)) {
      markPublished(notification.key);
      notificationRealtimeEvents.publish(notification);
    }
    // Browser fan-out and Bark delivery have separate idempotency state. A duplicate app-server
    // completion must not toast twice, but it may legitimately retry a Bark attempt that exhausted
    // its transient network retries and therefore was never marked delivered.
    await Promise.all([
      deliverBarkNotification(notification),
      deliverAndroidNotification(notification),
    ]);
  },
};

function alreadyPublished(key: string) {
  return gatewayMemoryState.publishedNotificationKeys.includes(key);
}

function markPublished(key: string) {
  gatewayMemoryState.publishedNotificationKeys = [
    ...gatewayMemoryState.publishedNotificationKeys.slice(-(MAX_PUBLISHED_NOTIFICATION_KEYS - 1)),
    key,
  ];
}
