import { getValidatedQuery } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { defineSupervisorEventHandler } from "../../utils/gateway/supervisor/http";
import { supervisorThreadReadSchema } from "../../utils/gateway/http/validation/supervisor";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { hostStore } from "../../utils/gateway/state/hosts";
import { projectStore } from "../../utils/gateway/state/projects";
import { gatewayMemoryState } from "../../utils/gateway/state/memory";

export default defineSupervisorEventHandler("thread.history.read", async (event, grant) => {
  const query = await getValidatedQuery(event, (value) => supervisorThreadReadSchema.parse(value));
  const host = requireRecord(hostStore.getWithSecret(grant.hostId), "Host not found");
  const page = await threadBroker.listThreadTurns(host, grant.threadId, {
    cursor: query.cursor ?? null,
    limit: query.limit,
    sortDirection: query.sortDirection,
  });
  const pinned = gatewayMemoryState.pinnedThreads.find(
    (item) => item.hostId === grant.hostId && item.threadId === grant.threadId,
  );
  const project = grant.projectId === null ? null : projectStore.get(grant.projectId);
  return {
    scope: {
      grantId: grant.id,
      label: grant.label,
      expiresAt: grant.expiresAt,
      persistent: grant.persistent,
      hostId: grant.hostId,
      hostName: host.name,
      projectId: grant.projectId,
      projectName: project?.name ?? pinned?.projectName ?? null,
      threadId: grant.threadId,
      threadTitle: pinned?.title ?? grant.label,
      permissions: grant.permissions,
    },
    observedAt: new Date().toISOString(),
    ...page,
  };
});
