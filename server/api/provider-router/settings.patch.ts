import { readValidatedBody } from "h3";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { providerRoutingSettingsSchema } from "../../utils/gateway/http/validation/config";
import { runtimeConfigStore } from "../../utils/gateway/state/runtime-config";

export default defineGatewayConfigMutationHandler(async (event) => {
  const userId = event.context.auth!.user.id;
  const body = await readValidatedBody(event, (value) =>
    providerRoutingSettingsSchema.parse(value),
  );
  return userConfigMutationService.commit(userId, () => {
    runtimeConfigStore.replaceProviderRouting(body);
    return runtimeConfigStore.export().providerRouting;
  });
});
