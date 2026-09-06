import { readValidatedBody } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { hostCreateSchema } from "../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../utils/gateway/state/hosts";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => hostCreateSchema.parse(body));
  return userConfigMutationService.commit(event.context.auth!.user.id, () =>
    hostStore.create(input),
  );
});
