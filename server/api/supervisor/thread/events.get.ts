import { getValidatedQuery } from "h3";
import { defineSupervisorEventHandler } from "../../../utils/gateway/supervisor/http";
import { supervisorThreadEventsSchema } from "../../../utils/gateway/http/validation/supervisor";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { gatewayEventStore } from "../../../utils/gateway/state/gateway-events";

export default defineSupervisorEventHandler("thread.events.read", async (event, grant) => {
  const query = await getValidatedQuery(event, (value) =>
    supervisorThreadEventsSchema.parse(value),
  );
  requireRecord(hostStore.get(grant.hostId), "Host not found");
  const eventEpoch = gatewayEventStore.epoch(grant.hostId);
  const epochMismatch = query.afterEpoch !== undefined && query.afterEpoch !== eventEpoch;
  const replayGap =
    epochMismatch || gatewayEventStore.hasReplayGap(grant.hostId, grant.threadId, query.afterId);
  const events = replayGap
    ? []
    : gatewayEventStore.list(grant.hostId, grant.threadId, query.afterId, query.limit);
  return {
    scope: {
      grantId: grant.id,
      hostId: grant.hostId,
      projectId: grant.projectId,
      threadId: grant.threadId,
      permissions: grant.permissions,
      persistent: grant.persistent,
      expiresAt: grant.expiresAt,
    },
    observedAt: new Date().toISOString(),
    eventEpoch,
    replayGap,
    latestEventId: gatewayEventStore.latestId(grant.hostId, grant.threadId),
    events,
  };
});
