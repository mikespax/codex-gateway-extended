import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { providerRouterStatus } from "../../utils/gateway/provider-router/policy";

export default defineGatewayEventHandler(() => {
  // Status is a read path and must remain fast when OpenRouter is unavailable. Model discovery
  // is an explicit recheck operation; do not put a network timeout in every settings poll.
  return providerRouterStatus();
});
