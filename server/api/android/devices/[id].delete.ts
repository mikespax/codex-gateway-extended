import { createError, getRouterParam } from "h3";
import { requireAuthenticatedUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { androidDeviceRepository } from "../../../utils/gateway/notifications/android-device-repository";

export default defineGatewayEventHandler((event) => {
  const user = requireAuthenticatedUser(event);
  const deviceId = getRouterParam(event, "id")?.trim() ?? "";
  if (deviceId === "" || androidDeviceRepository.revoke(user.id, deviceId) === 0) {
    throw createError({ statusCode: 404, statusMessage: "Android device not found" });
  }
  return { revoked: true };
});
