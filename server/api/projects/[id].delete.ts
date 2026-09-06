import { getRouterParam } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { projectStore } from "../../utils/gateway/state/projects";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler((event) => {
  const id = Number(getRouterParam(event, "id"));
  userConfigMutationService.commit(event.context.auth!.user.id, () =>
    requireRecord(projectStore.delete(id), "Project not found"),
  );
  return { ok: true };
});
