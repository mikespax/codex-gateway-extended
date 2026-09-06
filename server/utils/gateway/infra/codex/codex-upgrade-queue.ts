import pLimit from "p-limit";
import { currentGatewayUserId, runWithGatewayUser } from "../../state/memory";
import type { HostWithSecret } from "../ssh/ssh-types";
import { codexUpgradeError, codexUpgradeLog } from "./codex-upgrade-log";

const UPGRADE_CONCURRENCY = 3;

/**
 * Remote installs share the Gateway's outbound bandwidth, so only artifact preparation, transfer,
 * and installation enter this bounded queue. Three slots prevent one slow Host from blocking every
 * upgrade while keeping version probes and normal Host traffic outside the queue.
 */
export class CodexUpgradeQueue {
  private readonly limit = pLimit(UPGRADE_CONCURRENCY);

  get busy() {
    return this.limit.activeCount > 0 || this.limit.pendingCount > 0;
  }

  async run<T>(host: HostWithSecret, work: () => Promise<T>) {
    const userId = currentGatewayUserId();
    const queuedAt = Date.now();
    codexUpgradeLog("workflow queued", host, {
      queuePosition: this.limit.activeCount + this.limit.pendingCount + 1,
    });
    return await this.limit(async () => {
      const run = async () => {
        const startedAt = Date.now();
        codexUpgradeLog("workflow started", host, { queueWaitMs: startedAt - queuedAt });
        try {
          const result = await work();
          codexUpgradeLog("workflow completed", host, { durationMs: Date.now() - startedAt });
          return result;
        } catch (error: unknown) {
          codexUpgradeError("workflow failed", host, error, {
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
      };
      return await (userId === null ? run() : runWithGatewayUser(userId, run));
    });
  }
}
