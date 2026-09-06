import { currentGatewayUserId } from "../../state/memory";
import type { HostWithSecret } from "../ssh/ssh-types";

type UpgradeLogDetails = Record<string, unknown>;

export function codexUpgradeLog(
  event: string,
  host: HostWithSecret,
  details: UpgradeLogDetails = {},
) {
  console.info("[gateway-upgrade]", upgradeLogRecord(event, host, details));
}

export function codexUpgradeError(
  event: string,
  host: HostWithSecret,
  error: unknown,
  details: UpgradeLogDetails = {},
) {
  console.error(
    "[gateway-upgrade]",
    upgradeLogRecord(event, host, {
      ...details,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

function upgradeLogRecord(event: string, host: HostWithSecret, details: UpgradeLogDetails) {
  return {
    event,
    userId: currentGatewayUserId(),
    hostId: host.id,
    hostName: host.name || host.sshHost,
    sshHost: host.sshHost,
    ...details,
  };
}
