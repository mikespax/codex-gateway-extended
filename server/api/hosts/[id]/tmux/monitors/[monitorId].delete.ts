import { getRouterParam } from "h3";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../../utils/gateway/http/validation/common";
import { hostStore } from "../../../../../utils/gateway/state/hosts";
import { tmuxMonitorService } from "../../../../../utils/gateway/tmux-monitor/monitor-service";

export default defineGatewayEventHandler((event) => {
  const hostId = Number(getRouterParam(event, "id"));
  const monitorId = Number(getRouterParam(event, "monitorId"));
  requireRecord(hostStore.get(hostId), "Host not found");
  return tmuxMonitorService.cancelForHost(event.context.auth!.user.id, hostId, monitorId);
});
