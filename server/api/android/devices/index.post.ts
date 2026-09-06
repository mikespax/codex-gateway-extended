import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAuthenticatedUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { androidDeviceRepository } from "../../../utils/gateway/notifications/android-device-repository";
import { firebaseConfigured } from "../../../utils/gateway/notifications/firebase-provider";

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    fcmToken: z.string().trim().min(20).max(4_096),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  const user = requireAuthenticatedUser(event);
  const body = await readValidatedBody(event, (value) => bodySchema.parse(value));
  return {
    ...androidDeviceRepository.register(user.id, body.name, body.fcmToken),
    firebaseConfigured: firebaseConfigured(),
  };
});
