import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { updateProviderRouterState } from "../../utils/gateway/provider-router/state";
import { providerRouterStatus } from "../../utils/gateway/provider-router/policy";

export default defineGatewayEventHandler(() => {
  updateProviderRouterState((state) => {
    state.openaiQuota = "available";
    state.openaiQuotaDetectedAt = null;
    state.openaiQuotaResetAt = null;
    state.openaiQuotaReason = null;
  });
  return providerRouterStatus();
});
