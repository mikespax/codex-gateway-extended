import type { HostRecord } from "~~/shared/types";
import { runtimeStatusFromSnapshotState } from "~~/shared/thread-runtime-status";
import { gatewayEventStore } from "../state/gateway-events";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { threadBroker } from "./broker";
import { runtimeLog } from "./runtime-log";
import { activeMainThreadMonitor } from "./active-main-thread-monitor";
import { currentGatewayUserId } from "../state/memory";

export const RUNNING_THREAD_STALE_MS = 90_000;
const STALE_SCAN_FAILURE_BACKOFF_MS = 5 * 60_000;
const staleScanRetryAfter = new Map<string, number>();

interface RefreshRunningThreadsInput {
  host: HostRecord;
  reason: "host-connected" | "stale-scan";
  staleOnly?: boolean;
  staleMs?: number;
}

export async function refreshRunningThreadsForHost({
  host,
  reason,
  staleOnly = false,
  staleMs = RUNNING_THREAD_STALE_MS,
}: RefreshRunningThreadsInput) {
  const candidates = runningThreadCandidates(host.id, {
    staleOnly,
    staleMs,
  });
  if (!candidates.length) {
    return { refreshed: 0, failed: 0 };
  }

  runtimeLog("refreshing running thread states", {
    hostId: host.id,
    reason,
    count: candidates.length,
  });

  let refreshed = 0;
  let failed = 0;
  const client = await threadBroker.getHostClient(host);
  for (const candidate of candidates) {
    // A foreground controller already owns the live subscription and receives the authoritative
    // status events. Do not add a metadata read on the same Host RPC channel while the browser is
    // opening or using the thread; that redundant read is especially expensive for legacy
    // rollouts on a slow worker.
    if (reason === "stale-scan" && threadBroker.hasController(host.id, candidate.threadId)) {
      continue;
    }
    try {
      const result = await threadBroker.refreshThreadRuntimeStatus(host, candidate.threadId);
      clearStaleScanBackoff(host.id, candidate.threadId);
      if (result.status === "running") {
        await activeMainThreadMonitor.observeKnownActiveThread(
          {
            host,
            client,
            hasController: (threadId) => threadBroker.hasController(host.id, threadId),
          },
          candidate.threadId,
        );
      }
      refreshed += 1;
    } catch (error) {
      failed += 1;
      if (reason === "stale-scan") {
        staleScanRetryAfter.set(
          staleScanKey(host.id, candidate.threadId),
          Date.now() + STALE_SCAN_FAILURE_BACKOFF_MS,
        );
      }
      runtimeLog("running thread state refresh failed", {
        hostId: host.id,
        threadId: candidate.threadId,
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  runtimeLog("refreshed running thread states", {
    hostId: host.id,
    reason,
    refreshed,
    failed,
  });
  return { refreshed, failed };
}

function runningThreadCandidates(hostId: number, options: { staleOnly: boolean; staleMs: number }) {
  const now = Date.now();
  return threadSnapshotStore
    .listForHost(hostId)
    .map((record) => {
      return {
        threadId: record.threadId,
        projectId: record.snapshot.projectId ?? null,
        runtimeStatus: runtimeStatusFromSnapshotState(
          record.snapshot.thread,
          record.snapshot.history,
        ),
        latestActivityAt: latestActivityAt(hostId, record.threadId, record.updatedAt),
      };
    })
    .filter((candidate) => {
      if (candidate.runtimeStatus !== "running") {
        return false;
      }
      if (!options.staleOnly) {
        return true;
      }
      // The selected/previewed thread has a controller-backed subscription. Its status is already
      // projected from live events, so a stale-scan read would only compete with the foreground
      // open on the shared RPC connection.
      if (threadBroker.hasController(hostId, candidate.threadId)) {
        return false;
      }
      if (staleScanIsBackedOff(hostId, candidate.threadId, now)) {
        return false;
      }
      return now - candidate.latestActivityAt >= options.staleMs;
    });
}

function staleScanIsBackedOff(hostId: number, threadId: string, now: number) {
  const key = staleScanKey(hostId, threadId);
  const retryAfter = staleScanRetryAfter.get(key);
  if (retryAfter === undefined) return false;
  if (retryAfter <= now) {
    staleScanRetryAfter.delete(key);
    return false;
  }
  return true;
}

function clearStaleScanBackoff(hostId: number, threadId: string) {
  staleScanRetryAfter.delete(staleScanKey(hostId, threadId));
}

function staleScanKey(hostId: number, threadId: string) {
  return `${currentGatewayUserId() ?? "anonymous"}:${hostId}:${threadId}`;
}

function latestActivityAt(hostId: number, threadId: string, snapshotUpdatedAt: string) {
  const eventCreatedAt = gatewayEventStore.latest(hostId, threadId)?.createdAt;
  const parsed = Date.parse(eventCreatedAt ?? snapshotUpdatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
