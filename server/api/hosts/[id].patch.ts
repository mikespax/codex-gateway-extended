import { getRouterParam, readValidatedBody } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { hostUpdateSchema } from "../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../utils/gateway/state/hosts";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  const userId = event.context.auth!.user.id;
  const input = await readValidatedBody(event, (body) => hostUpdateSchema.parse(body));
  requireRecord(hostStore.getWithSecret(id), "Host not found");
  return userConfigMutationService.commit(userId, () =>
    requireRecord(hostStore.update(id, input), "Host not found"),
  );
});
