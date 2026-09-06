import { readValidatedBody } from "h3";
import { z } from "zod";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { notificationSettingsSchema } from "../../utils/gateway/http/validation/config";
import { runtimeConfigStore } from "../../utils/gateway/state/runtime-config";

const bodySchema = z.object({ notifications: notificationSettingsSchema }).strict();

export default defineGatewayConfigMutationHandler(async (event) => {
  const userId = event.context.auth!.user.id;
  const body = await readValidatedBody(event, (value) => bodySchema.parse(value));
  return userConfigMutationService.commit(userId, () => {
    runtimeConfigStore.replaceNotifications(body.notifications);
    return runtimeConfigStore.export();
  });
});
