import { readValidatedBody } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { projectCreateSchema } from "../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../utils/gateway/state/hosts";
import { projectStore } from "../../utils/gateway/state/projects";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => projectCreateSchema.parse(body));
  requireRecord(hostStore.get(input.hostId), "Host not found");
  return userConfigMutationService.commit(event.context.auth!.user.id, () =>
    projectStore.create(input),
  );
});
