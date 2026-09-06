import type { CodexRpcClient } from "../infra/rpc/rpc";
import type { ThreadGoalResolver, ThreadMetadataResolver } from "./thread-runtime-events";
import type { RateLimitsResolver } from "../usage/turn-usage-accounting";

const NOTIFICATION_INSPECTION_TIMEOUT_MS = 10_000;

export interface ThreadNotificationResolvers {
  resolveGoal: ThreadGoalResolver;
  resolveThread: ThreadMetadataResolver;
  resolveRateLimits: RateLimitsResolver;
  protocolVersion: string | null;
  protocolSchemaHash: string | null;
}

export function createThreadNotificationResolvers(
  client: CodexRpcClient,
  threadId: string,
): ThreadNotificationResolvers {
  return {
    // Notification enrichment is a bounded, concurrent read. It must not enter a controller's
    // mutation queue: an unavailable metadata request must never block a later user goal or turn.
    resolveGoal: () =>
      client.request("thread/goal/get", { threadId }, NOTIFICATION_INSPECTION_TIMEOUT_MS),
    resolveThread: () =>
      client.request(
        "thread/read",
        { threadId, includeTurns: false },
        NOTIFICATION_INSPECTION_TIMEOUT_MS,
      ),
    resolveRateLimits: () =>
      client.request("account/rateLimits/read", undefined, NOTIFICATION_INSPECTION_TIMEOUT_MS),
    protocolVersion: client.protocolVersion(),
    protocolSchemaHash: client.protocolSchemaHash(),
  };
}
