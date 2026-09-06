import { readValidatedBody } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { parseGatewayConfig } from "../../utils/gateway/http/validation/config";
import { runtimeConfigStore } from "../../utils/gateway/state/runtime-config";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler(async (event) => {
  const userId = event.context.auth!.user.id;
  const config = await readValidatedBody(event, parseGatewayConfig);
  return userConfigMutationService.commit(userId, () => {
    runtimeConfigStore.replace(config);
    return runtimeConfigStore.export();
  });
});
