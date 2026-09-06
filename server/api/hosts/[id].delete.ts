import { getRouterParam } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { hostStore } from "../../utils/gateway/state/hosts";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler((event) => {
  const id = Number(getRouterParam(event, "id"));
  const userId = event.context.auth!.user.id;
  userConfigMutationService.commit(userId, () => hostStore.delete(id));
  return { ok: true };
});
