import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { refreshOpenRouterModels } from "../../utils/gateway/provider-router/models";
import { updateProviderRouterState } from "../../utils/gateway/provider-router/state";
import { providerRouterStatus } from "../../utils/gateway/provider-router/policy";

export default defineGatewayEventHandler(async () => {
  await refreshOpenRouterModels(true);
  updateProviderRouterState((state) => {
    state.openrouter = "unknown";
    state.openrouterLastError = null;
  });
  return providerRouterStatus();
});
