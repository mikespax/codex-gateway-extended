import pLimit from "p-limit";
import { userStore } from "../auth/users";
import { runWithGatewayUser } from "../state/memory";
import { tmuxMonitorService } from "./monitor-service";

const HOST_POLL_CONCURRENCY = 3;

export class TmuxMonitorPollCoordinator {
  private running = false;

  async run() {
    if (this.running) return { skipped: true, checkedHosts: 0 };
    this.running = true;
    try {
      const groups = tmuxMonitorService.pollGroups();
      const limit = pLimit(HOST_POLL_CONCURRENCY);
      await Promise.all(
        groups.map((group) =>
          limit(() =>
            runWithGatewayUser(group.userId, async () => {
              const host = userStore
                .loadConfig(group.userId)
                .hosts.find((candidate) => candidate.id === group.hostId);
              if (!host) {
                tmuxMonitorService.removeHost(group.userId, group.hostId);
                return;
              }
              await tmuxMonitorService
                .deliverPendingNotifications(host, group.pendingNotifications)
                .catch((error) => {
                  console.error("[gateway-tmux] pending notification delivery failed", {
                    userId: group.userId,
                    hostId: group.hostId,
                    hostName: host.name,
                    message: error instanceof Error ? error.message : String(error),
                  });
                });
              if (group.monitors.length === 0) return;
              await tmuxMonitorService
                .checkHost(group.userId, host, group.monitors)
                .catch((error) => {
                  console.error("[gateway-tmux] monitor poll failed", {
                    userId: group.userId,
                    hostId: group.hostId,
                    hostName: host.name,
                    message: error instanceof Error ? error.message : String(error),
                  });
                });
            }),
          ),
        ),
      );
      return { skipped: false, checkedHosts: groups.length };
    } finally {
      this.running = false;
    }
  }
}

export const tmuxMonitorPollCoordinator = new TmuxMonitorPollCoordinator();
