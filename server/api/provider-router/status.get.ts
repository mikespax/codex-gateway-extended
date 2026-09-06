import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { providerRouterStatus } from "../../utils/gateway/provider-router/policy";
import { refreshOpenRouterModels } from "../../utils/gateway/provider-router/models";

export default defineGatewayEventHandler(async () => {
  await refreshOpenRouterModels();
  return providerRouterStatus();
});
