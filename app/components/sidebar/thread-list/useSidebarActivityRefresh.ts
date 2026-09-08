import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { threadTurnsFromHistory } from "~~/shared/thread-history/shape";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { requestThreadTurnsPage } from "@/stores/gateway-thread-turns/transport";

const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_AFTER_FAILURE_MS = 10_000;
const SIDEBAR_TURN_LIMIT = 3;
const MAX_CONCURRENT_REFRESHES = 3;

export interface SidebarActivityTarget {
  hostId: number;
  threadId: string;
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
}
