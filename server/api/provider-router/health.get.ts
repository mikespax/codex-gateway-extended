import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { providerRouterStatus } from "../../utils/gateway/provider-router/policy";

export default defineGatewayEventHandler(() => {
  const status = providerRouterStatus();
  return { ok: true, ...status };
});
