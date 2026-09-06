import { normalizeNotificationSettings } from "~~/shared/config";
import { currentGatewayUserId, gatewayMemoryState } from "../state/memory";
import { BarkRequestError, sendBarkNotification } from "./bark-provider";
import type { ServerNotification } from "~~/shared/types";
import pRetry from "p-retry";

const MAX_DELIVERED_NOTIFICATION_KEYS = 1_000;
const pendingDeliveries = new Map<string, Promise<void>>();

export async function deliverBarkNotification(notification: ServerNotification) {
  const userId = currentGatewayUserId();
  if (userId === null) throw new Error("Bark delivery requires an authenticated user scope");
  const deliveryKey = `${userId}:${notification.key}`;
  const settings = normalizeNotificationSettings(gatewayMemoryState.notifications).bark;
  if (!settings.enabled || !settings.deviceKey) {
    return;
  }
  if (alreadyDelivered(notification.key)) return;
  const pending = pendingDeliveries.get(deliveryKey);
  if (pending !== undefined) return pending;
  markPending(notification.key);

  const delivery = pRetry(() => sendBarkNotification(settings, notification), {
    retries: 4,
    minTimeout: 1_000,
    maxTimeout: 15_000,
    factor: 2,
    shouldRetry: ({ error }) => !(error instanceof BarkRequestError) || error.retryable,
  })
    .then(() => {
      markDelivered(notification.key);
      logSuccessfulDelivery(userId, notification);
    })
    .finally(() => {
      pendingDeliveries.delete(deliveryKey);
      clearPending(notification.key);
    });
  pendingDeliveries.set(deliveryKey, delivery);
  return delivery;
}

function alreadyDelivered(key: string) {
  return gatewayMemoryState.deliveredNotificationKeys.includes(key);
}

function markPending(key: string) {
  gatewayMemoryState.pendingNotificationKeys = [...gatewayMemoryState.pendingNotificationKeys, key];
}

function clearPending(key: string) {
  gatewayMemoryState.pendingNotificationKeys = gatewayMemoryState.pendingNotificationKeys.filter(
    (candidate) => candidate !== key,
  );
}

function markDelivered(key: string) {
  gatewayMemoryState.deliveredNotificationKeys = [
    ...gatewayMemoryState.deliveredNotificationKeys.slice(-(MAX_DELIVERED_NOTIFICATION_KEYS - 1)),
    key,
  ];
}

function logSuccessfulDelivery(userId: number, notification: ServerNotification) {
  const { target } = notification;
  console.info("[notifications] Bark notification delivered", {
    userId,
    key: notification.key,
    targetKind: target.kind,
    hostId: target.hostId,
    projectId: target.projectId,
    threadId: target.threadId,
    ...(target.kind === "tmuxMonitor" ? { monitorId: target.monitorId } : {}),
  });
}
