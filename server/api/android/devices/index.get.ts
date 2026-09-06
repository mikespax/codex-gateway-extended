import { requireAuthenticatedUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { androidDeviceRepository } from "../../../utils/gateway/notifications/android-device-repository";
import { firebaseConfigured } from "../../../utils/gateway/notifications/firebase-provider";

export default defineGatewayEventHandler((event) => {
  const user = requireAuthenticatedUser(event);
  return {
    firebaseConfigured: firebaseConfigured(),
    devices: androidDeviceRepository.list(user.id).map((device) => ({
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
    })),
  };
});
