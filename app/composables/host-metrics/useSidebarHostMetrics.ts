import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { HostRecord, HostResourceUsageSummary } from "~~/shared/types";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { gatewayApi } from "@/utils/gateway-api";

export const SIDEBAR_HOST_METRICS_REFRESH_MS = 180_000;
export const SIDEBAR_HOST_METRICS_INITIAL_RETRY_MS = 5_000;

export function useSidebarHostMetrics(hosts: Ref<HostRecord[]>) {
  const auth = useAuthStore();
  const { isAuthenticated } = storeToRefs(auth);
  const usageByHost = ref<Record<number, HostResourceUsageSummary>>({});
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let requestVersion = 0;
  let refreshInFlight = false;
  let disposed = false;

  function clearRefreshTimer() {
    if (refreshTimer === null) return;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function scheduleRefresh(delayMs = SIDEBAR_HOST_METRICS_REFRESH_MS) {
    clearRefreshTimer();
    if (disposed) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, delayMs);
  }

  async function refresh() {
    if (!auth.isAuthenticated || refreshInFlight) return;
    refreshInFlight = true;
    const version = ++requestVersion;
    let retryForInitialSamples = false;
    try {
      const rows = await gatewayApi<HostResourceUsageSummary[]>("/api/hosts/metrics");
      if (disposed || version !== requestVersion) return;
      const knownHostIds = new Set(hosts.value.map((host) => host.id));
      const rowsByHostId = new Map(rows.map((row) => [row.hostId, row]));
      usageByHost.value = Object.fromEntries(
        rows.filter((row) => knownHostIds.has(row.hostId)).map((row) => [row.hostId, row]),
      );
      retryForInitialSamples = hosts.value.some((host) => {
        const summary = rowsByHostId.get(host.id);
        return (
          summary === undefined ||
          (summary.sampledAt === null &&
            (summary.status === "waiting" || summary.status === "collecting"))
        );
      });
    } catch {
      // Resource summaries are optional decoration; leave the last known values visible on a
      // transient request failure and retry on the normal three-minute cadence.
    } finally {
      refreshInFlight = false;
      if (!disposed && version === requestVersion) {
        scheduleRefresh(
          retryForInitialSamples
            ? SIDEBAR_HOST_METRICS_INITIAL_RETRY_MS
            : SIDEBAR_HOST_METRICS_REFRESH_MS,
        );
      }
    }
  }

  function usageForHost(hostId: number) {
    const summary = usageByHost.value[hostId];
    if (summary === undefined) return null;
    return `CPU ${formatPercent(summary.cpuPercent)} · RAM ${formatPercent(summary.memoryPercent)} · HDD ${formatPercent(summary.diskPercent)}`;
  }

  onMounted(() => {
    auth.hydrate();
    if (auth.isAuthenticated) void refresh();
  });
  watch(isAuthenticated, (authenticated) => {
    if (authenticated) {
      void refresh();
      return;
    }
    usageByHost.value = {};
    requestVersion += 1;
    clearRefreshTimer();
  });
  watch(
    hosts,
    () => {
      if (auth.isAuthenticated) void refresh();
    },
    { deep: true },
  );
  onBeforeUnmount(() => {
    disposed = true;
    requestVersion += 1;
    clearRefreshTimer();
  });

  return { usageByHost, usageForHost, refresh };
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}
