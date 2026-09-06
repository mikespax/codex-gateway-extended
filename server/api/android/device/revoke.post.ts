import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { requireAndroidDevice } from "../../../utils/gateway/notifications/android-device-auth";
import { androidDeviceRepository } from "../../../utils/gateway/notifications/android-device-repository";

export default defineGatewayEventHandler((event) => {
  const device = requireAndroidDevice(event);
  androidDeviceRepository.revoke(device.userId, device.id);
  return { revoked: true };
});
