import { getRouterParam, setResponseHeader } from "h3";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../../utils/gateway/http/errors";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { codexRateLimitSummaryFromResponse } from "../../../utils/gateway/protocol/account-rate-limits";
import { threadBroker } from "../../../utils/gateway/runtime/broker";
import { CodexRateLimitReadCache } from "../../../utils/gateway/runtime/rate-limit-read-cache";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { currentGatewayUserId } from "../../../utils/gateway/state/memory";

const rateLimitReadCache = new CodexRateLimitReadCache();

export default defineGatewayEventHandler(async (event) => {
  const hostId = Number(getRouterParam(event, "id"));
  const host = requireRecord(hostStore.getWithSecret(hostId), "Host not found");
  setGatewayRequestLogContext(event, "codex.rateLimits.read", hostLogContext(host));
  const userKey = currentGatewayUserId() ?? "anonymous";
  const key = `${userKey}:${host.id}:${host.updatedAt}`;
  const result = await rateLimitReadCache.read(key, async () => {
    const client = await threadBroker.getHostClient(host);
    const response = await client.request("account/rateLimits/read", undefined, 30_000);
    return codexRateLimitSummaryFromResponse(hostId, response);
  });
  // Keep the response out of a shared/browser cache: the server cache is explicitly scoped by
  // authenticated user, while an HTTP cache could otherwise retain one account's usage briefly
  // across a logout/login transition.
  setResponseHeader(event, "cache-control", "private, no-cache");
  setResponseHeader(event, "x-gateway-codex-usage-cache", result.cacheState);
  return result.value;
});
