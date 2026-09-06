import type { UsageQuotaSnapshot } from "~~/shared/types";
import {
  defineGatewayEventHandler,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { codexRateLimitSummaryFromResponse } from "../../utils/gateway/protocol/account-rate-limits";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { hostStore } from "../../utils/gateway/state/hosts";
import { turnUsageRepository } from "../../utils/gateway/usage/turn-usage-repository";

const RATE_LIMIT_TIMEOUT_MS = 15_000;

export default defineGatewayEventHandler(async (event) => {
  setGatewayRequestLogContext(event, "codex.usage.overview", {});
  const userId = event.context.auth!.user.id;
  const hosts = hostStore.listWithSecret();
  const hostNames = new Map(hostStore.list().map((host) => [host.id, host.name]));
  const results = await Promise.allSettled(
    hosts.map(async (host) => {
      const client = await threadBroker.getHostClient(host);
      const response = await client.request(
        "account/rateLimits/read",
        undefined,
        RATE_LIMIT_TIMEOUT_MS,
      );
      const observation = codexRateLimitSummaryFromResponse(host.id, response);
      turnUsageRepository.recordQuotaObservation(userId, observation);
      return observation;
    }),
  );
  const liveObservations = results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<ReturnType<typeof codexRateLimitSummaryFromResponse>> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);
  const dashboard = turnUsageRepository.dashboardSummary(userId);
  const quotaByKey = new Map(dashboard.quotaWindows.map((snapshot) => [snapshot.key, snapshot]));
  for (const observation of liveObservations) {
    for (const window of observation.windows) {
      const snapshot: UsageQuotaSnapshot = {
        hostId: observation.hostId,
        hostName: hostNames.get(observation.hostId) ?? null,
        key: window.key,
        usedPercent: window.usedPercent,
        remainingPercent: window.remainingPercent,
        windowDurationMins: window.windowDurationMins,
        resetsAt: window.resetsAt,
        limitId: observation.limitId,
        limitName: observation.limitName,
        planType: observation.planType,
        observedAt: observation.observedAt,
        source: "live",
      };
      const previous = quotaByKey.get(snapshot.key);
      if (previous === undefined || previous.observedAt <= snapshot.observedAt) {
        quotaByKey.set(snapshot.key, snapshot);
      }
    }
  }
  return {
    ...dashboard,
    generatedAt: Date.now(),
    quotaWindows: Array.from(quotaByKey.values()).map((snapshot) => ({
      ...snapshot,
      hostName: hostNames.get(snapshot.hostId) ?? snapshot.hostName,
    })),
    liveHostCount: liveObservations.length,
    failedHostCount: results.length - liveObservations.length,
  };
});
