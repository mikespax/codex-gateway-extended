import pRetry from "p-retry";
import type { ServerNotification } from "~~/shared/types";
import { currentGatewayUserId } from "../state/memory";
import { androidDeviceRepository } from "./android-device-repository";
import {
  FirebaseRequestError,
  firebaseConfigured,
  sendFirebaseNotification,
} from "./firebase-provider";

export async function deliverAndroidNotification(notification: ServerNotification) {
  if (!firebaseConfigured()) return;
  const userId = currentGatewayUserId();
  if (userId === null) throw new Error("Android delivery requires an authenticated user scope");
  const devices = androidDeviceRepository.list(userId);
  const deliveries = devices.map(async (device) => {
    androidDeviceRepository.prepareNotification(device.id, notification);
    if (androidDeviceRepository.notificationWasSent(device.id, notification.key)) return;
    try {
      await pRetry(() => sendFirebaseNotification(device, notification), {
        retries: 4,
        minTimeout: 1_000,
        maxTimeout: 15_000,
        factor: 2,
        shouldRetry: ({ error }) => !(error instanceof FirebaseRequestError) || error.retryable,
      });
      androidDeviceRepository.markNotificationSent(device.id, notification.key);
      console.info("[notifications] Android notification delivered", {
        userId,
        deviceId: device.id,
        key: notification.key,
        targetKind: notification.target.kind,
        hostId: notification.target.hostId,
        projectId: notification.target.projectId,
        threadId: notification.target.threadId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      androidDeviceRepository.markNotificationFailed(device.id, notification.key, message);
      console.error("[notifications] Android notification delivery failed", {
        userId,
        deviceId: device.id,
        key: notification.key,
        error: message,
      });
    }
  });
  await Promise.all(deliveries);
}
