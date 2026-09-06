<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ActivityIcon, AlertCircleIcon } from "@lucide/vue";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { hostById } from "@/stores/gateway-catalog/selectors";
import { useGatewayHostMetricsDataStore } from "@/stores/gateway-host-metrics/data";
import { useHostMetricsSubscription } from "@/composables/host-metrics/useHostMetricsSubscription";
import { useHostMetricCharts } from "@/composables/host-metrics/useHostMetricCharts";
import { formatByteRate, formatBytes, formatPercent } from "@/utils/host-metrics";
import HostMetricCard from "./HostMetricCard.vue";
import HostMetricLineChart from "./HostMetricLineChart.client.vue";
import HostFilesystemList from "./HostFilesystemList.vue";
import HostGpuProcessList from "./HostGpuProcessList.vue";

const props = defineProps<{ hostId: number }>();
const root = ref<HTMLElement | null>(null);
const catalog = useGatewayCatalogStore();
const metrics = useGatewayHostMetricsDataStore();
const { hosts } = storeToRefs(catalog);
const hostId = computed(() => props.hostId);
const host = computed(() => hostById(hosts.value, hostId.value));
const state = computed(() => metrics.hosts[hostId.value] ?? null);
const samples = computed(() => state.value?.samples ?? []);
const charts = useHostMetricCharts(samples);
const latest = charts.latest;
const currentGpus = computed(() => latest.value?.gpus ?? []);
const gpuProcesses = computed(() => state.value?.gpuProcesses ?? null);
const lastUpdated = computed(() => latest.value?.sampledAt ?? null);
useHostMetricsSubscription(root, hostId);
</script>

<template>
  <div ref="root" class="h-full min-h-0 overflow-y-auto bg-canvas" data-testid="host-metrics-panel">
    <div class="mx-auto w-full max-w-screen-2xl space-y-4 p-4 sm:p-5">
      <header class="flex flex-wrap items-center gap-3">
        <div class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <ActivityIcon class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-base font-semibold text-ink">
            {{ host?.name ?? $t("app.hostMonitor") }}
          </h1>
          <p class="text-xs text-ink-muted">
            {{ $t("app.hostMonitorWindow") }}
            <span v-if="lastUpdated"> · {{ new Date(lastUpdated).toLocaleTimeString() }}</span>
          </p>
        </div>
        <span class="rounded-full bg-canvas-soft px-3 py-1 text-xs text-ink-muted">
          {{ $t(`app.hostMetricsStatus.${state?.status ?? "waiting"}`) }}
        </span>
      </header>

      <div
        v-if="state?.message && state.status !== 'collecting'"
        class="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        <AlertCircleIcon class="mt-0.5 size-4 shrink-0" />
        <span>{{ state.message }}</span>
      </div>

      <div v-if="latest" class="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <HostMetricCard
          test-id="host-metric-cpu"
          :title="$t('app.hostMetricCpu')"
          :value="formatPercent(latest.cpu.usagePercent)"
          :subtitle="`Load ${latest.cpu.loadAverage.map((value) => value.toFixed(2)).join(' / ')}`"
        >
          <HostMetricLineChart :series="charts.cpuSeries.value" value-suffix="%" :maximum="100" />
        </HostMetricCard>
        <HostMetricCard
          test-id="host-metric-memory"
          :title="$t('app.hostMetricMemory')"
          :value="formatPercent(latest.memory.usagePercent)"
          :subtitle="`${formatBytes(latest.memory.usedBytes)} / ${formatBytes(latest.memory.totalBytes)}`"
        >
          <HostMetricLineChart
            :series="charts.memorySeries.value"
            value-suffix="%"
            :maximum="100"
          />
        </HostMetricCard>
        <HostMetricCard
          test-id="host-metric-network"
          :title="$t('app.hostMetricNetwork')"
          :value="`${formatByteRate(latest.network.receiveBytesPerSecond)} ↓`"
          :subtitle="`${latest.network.interfaces.join(', ') || '-'} · ${formatByteRate(latest.network.transmitBytesPerSecond)} ↑`"
        >
          <HostMetricLineChart :series="charts.networkSeries.value" value-suffix=" MiB/s" />
        </HostMetricCard>
        <HostMetricCard
          test-id="host-metric-disk"
          :title="$t('app.hostMetricDisk')"
          :value="`${formatByteRate(latest.disk.readBytesPerSecond)} R`"
          :subtitle="`${formatByteRate(latest.disk.writeBytesPerSecond)} W`"
        >
          <HostMetricLineChart :series="charts.diskSeries.value" value-suffix=" MiB/s" />
          <HostFilesystemList :filesystems="latest.disk.filesystems" />
        </HostMetricCard>
      </div>

      <section v-if="currentGpus.length" class="space-y-3">
        <h2 class="text-sm font-semibold text-ink">{{ $t("app.hostMetricGpu") }}</h2>
        <div class="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <HostMetricCard
            v-for="gpu in currentGpus"
            :key="gpu.uuid"
            :test-id="`host-metric-gpu-${gpu.index}`"
            :title="`GPU ${gpu.index} · ${gpu.name}`"
            :value="formatPercent(gpu.utilizationPercent)"
            :subtitle="`${formatBytes(gpu.memoryUsedBytes)} / ${formatBytes(gpu.memoryTotalBytes)} VRAM · ${gpu.temperatureCelsius ?? '-'}°C`"
          >
            <HostMetricLineChart
              :series="charts.gpuSeries(gpu)"
              value-suffix="%"
              secondary-suffix="°C"
              :maximum="100"
            />
          </HostMetricCard>
        </div>
        <HostGpuProcessList
          :snapshot="gpuProcesses"
          :gpus="currentGpus"
          :current-username="host?.username ?? null"
        />
      </section>

      <div
        v-else-if="!latest"
        class="grid min-h-64 place-items-center rounded-xl border border-dashed border-hairline text-sm text-ink-muted"
      >
        {{ $t("app.hostMetricsWaiting") }}
      </div>
    </div>
  </div>
</template>
