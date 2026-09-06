import { createError, readValidatedBody } from "h3";
import { z } from "zod";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { requireAndroidDevice } from "../../../utils/gateway/notifications/android-device-auth";
import { androidDeviceRepository } from "../../../utils/gateway/notifications/android-device-repository";

const bodySchema = z.object({ fcmToken: z.string().trim().min(20).max(4_096) }).strict();

export default defineGatewayEventHandler(async (event) => {
  const device = requireAndroidDevice(event);
  const body = await readValidatedBody(event, (value) => bodySchema.parse(value));
  if (!androidDeviceRepository.updateFcmToken(device.id, device.userId, body.fcmToken)) {
    throw createError({ statusCode: 404, statusMessage: "Android device not found" });
  }
  return { updated: true };
});
