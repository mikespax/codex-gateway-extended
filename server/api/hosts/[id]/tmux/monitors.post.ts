import { getRouterParam, readValidatedBody } from "h3";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../../../utils/gateway/http/errors";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import { createTmuxMonitorSchema } from "../../../../utils/gateway/http/validation/tmux";
import { hostStore } from "../../../../utils/gateway/state/hosts";
import { tmuxMonitorService } from "../../../../utils/gateway/tmux-monitor/monitor-service";
import { hostRuntimeFingerprint } from "../../../../utils/gateway/runtime/host-runtime-fingerprint";

export default defineGatewayEventHandler(async (event) => {
  const hostId = Number(getRouterParam(event, "id"));
  const host = requireRecord(hostStore.getWithSecret(hostId), "Host not found");
  const fingerprint = hostRuntimeFingerprint(host);
  const body = await readValidatedBody(event, (value) => createTmuxMonitorSchema.parse(value));
  setGatewayRequestLogContext(event, "tmux.monitors.create", {
    ...hostLogContext(host),
    sessionId: body.sessionId,
    paneId: body.paneId,
  });
  return await tmuxMonitorService.create(event.context.auth!.user.id, host, body, () => {
    const current = hostStore.getWithSecret(hostId);
    return current !== null && hostRuntimeFingerprint(current) === fingerprint;
  });
});
