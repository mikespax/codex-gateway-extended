import { getValidatedQuery } from "h3";
import { z } from "zod";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { hostStore } from "../../utils/gateway/state/hosts";
import { threadSnapshotStore } from "../../utils/gateway/state/thread-snapshots";
import { lastThreadRoute } from "../../utils/gateway/provider-router/logging";

const querySchema = z.object({
  hostId: z.coerce.number().int().positive(),
  threadId: z.string().min(1).max(128),
});
export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (value) => querySchema.parse(value));
  requireRecord(hostStore.get(query.hostId), "Host not found");
  const snapshot = threadSnapshotStore.get(query.hostId, query.threadId);
  const route = lastThreadRoute(query.hostId, query.threadId);
  return {
    model: route?.model ?? snapshot?.threadSettings?.model ?? snapshot?.thread.model ?? null,
    transport: route?.transport ?? snapshot?.thread.modelProvider ?? null,
    reason: route?.reason ?? null,
    recordedAt: route?.recordedAt ?? null,
  };
});
