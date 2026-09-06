import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { hostMetricsManager } from "../../utils/gateway/infra/host-services";
import { hostStore } from "../../utils/gateway/state/hosts";

export default defineGatewayEventHandler((event) => {
  const userId = event.context.auth!.user.id;
  const hosts = hostStore.listWithSecret();
  // Loading the sidebar host list is guaranteed during normal navigation. Start collection here
  // too, so metrics do not depend solely on an optional decoration request completing first.
  for (const host of hosts) hostMetricsManager.ensureCollector(userId, host);
  return hostStore.list();
});
