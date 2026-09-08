import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { threadTurnsFromHistory } from "~~/shared/thread-history/shape";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { requestThreadTurnsPage } from "@/stores/gateway-thread-turns/transport";
import {
  requestSidebarAiSummaries,
  requestSidebarThreadStorage,
} from "@/stores/gateway-thread-activity/transport";

const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_AFTER_FAILURE_MS = 10_000;
const SIDEBAR_TURN_LIMIT = 3;
const MAX_CONCURRENT_REFRESHES = 3;

export interface SidebarActivityTarget {
  hostId: number;
  threadId: string;
  path: string | null;
}

/** Keep unselected rows current without opening a full thread view for every conversation. */
export function useSidebarActivityRefresh(targets: Ref<SidebarActivityTarget[]>) {
  const activity = useGatewayThreadActivityStore();
  const nextRefreshAt = new Map<string, number>();
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let refreshPromise: Promise<void> | null = null;

  async function refresh(force = false) {
    if (refreshPromise !== null) return refreshPromise;
    const now = Date.now();
    const pending = targets.value.filter((target) => {
      const key = `${target.hostId}:${target.threadId}`;
      return !inFlight.has(key) && (force || (nextRefreshAt.get(key) ?? 0) <= now);
    });
    if (pending.length === 0) return;

    refreshPromise = (async () => {
      let cursor = 0;
      async function worker() {
        while (cursor < pending.length) {
          const target = pending[cursor++];
          if (target === undefined) return;
          const key = `${target.hostId}:${target.threadId}`;
          inFlight.add(key);
          nextRefreshAt.set(key, Date.now() + REFRESH_INTERVAL_MS);
          try {
            const result = await requestThreadTurnsPage({
              hostId: target.hostId,
              threadId: target.threadId,
              cursor: null,
              limit: SIDEBAR_TURN_LIMIT,
              sortDirection: "desc",
            });
            activity.ingestSidebarTurns(
              target.hostId,
              target.threadId,
              threadTurnsFromHistory(result.history),
            );
          } catch {
            // Sidebar activity is advisory. Retry the target soon without surfacing a toast or
            // allowing one unavailable host to block the other rows.
            nextRefreshAt.set(key, Date.now() + REFRESH_AFTER_FAILURE_MS);
          } finally {
            inFlight.delete(key);
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT_REFRESHES, pending.length) }, () => worker()),
      );
      await Promise.all([refreshThreadStorage(pending), refreshAiSummaries(pending)]);
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  onMounted(() => {
    void refresh(true);
    timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  });
  watch(targets, () => void refresh(), { deep: true, flush: "post" });
  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer);
  });

  return { refresh };

  async function refreshThreadStorage(refreshedTargets: SidebarActivityTarget[]) {
    const byHost = new Map<number, Array<{ threadId: string; path: string | null }>>();
    for (const target of refreshedTargets) {
      const group = byHost.get(target.hostId) ?? [];
      group.push({ threadId: target.threadId, path: target.path });
      byHost.set(target.hostId, group);
    }
    await Promise.all(
      [...byHost].map(async ([hostId, threads]) => {
        try {
          const result = await requestSidebarThreadStorage({ hostId, threads });
          for (const item of result.data) {
            activity.updateThreadBytes(hostId, item.threadId, item.threadBytes);
          }
        } catch {
          // Storage is advisory. A host that is offline must not suppress activity or summaries.
        }
      }),
    );
  }

  async function refreshAiSummaries(refreshedTargets: SidebarActivityTarget[]) {
    const items = refreshedTargets.flatMap((target) => {
      const summary = activity.summariesByKey[`${target.hostId}:${target.threadId}`];
      return summary === undefined
        ? []
        : [
            {
              hostId: target.hostId,
              threadId: target.threadId,
              goal: summary.goalObjective ?? null,
              turnSummary: summary.turnSummary ?? null,
              currentTask: summary.currentOperation ?? null,
              lastUserInput: summary.lastUserInput ?? null,
            },
          ];
    });
    if (items.length === 0) return;
    try {
      const result = await requestSidebarAiSummaries(items);
      for (const summary of result.data) activity.applyAiSidebarSummary(summary);
    } catch {
      // AI summaries are optional. The local projection remains visible when the helper is
      // unavailable, unauthenticated, or still warming up on the Mac.
    }
  }
}
