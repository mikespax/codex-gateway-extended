import { getRouterParam } from "h3";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../../utils/gateway/http/errors";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { codexRateLimitSummaryFromResponse } from "../../../utils/gateway/protocol/account-rate-limits";
import { threadBroker } from "../../../utils/gateway/runtime/broker";
import { hostStore } from "../../../utils/gateway/state/hosts";

export default defineGatewayEventHandler(async (event) => {
  const hostId = Number(getRouterParam(event, "id"));
  const host = requireRecord(hostStore.getWithSecret(hostId), "Host not found");
  setGatewayRequestLogContext(event, "codex.rateLimits.read", hostLogContext(host));
  const client = await threadBroker.getHostClient(host);
  const response = await client.request("account/rateLimits/read", undefined, 30_000);
  return codexRateLimitSummaryFromResponse(hostId, response);
});
