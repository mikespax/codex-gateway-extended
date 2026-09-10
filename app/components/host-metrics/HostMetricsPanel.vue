<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ActivityIcon } from "@lucide/vue";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { hostById } from "@/stores/gateway-catalog/selectors";
import HostMetricsHostSection from "./HostMetricsHostSection.vue";

const props = defineProps<{ hostId: number; allHosts?: boolean }>();
const catalog = useGatewayCatalogStore();
const { hosts } = storeToRefs(catalog);
const monitoredHosts = computed(() => {
  if (props.allHosts) return hosts.value;
  const host = hostById(hosts.value, props.hostId);
  return host === null ? [] : [host];
});
</script>

<template>
  <div class="h-full min-h-0 overflow-y-auto bg-canvas" data-testid="host-metrics-panel">
    <div class="mx-auto w-full max-w-screen-2xl space-y-4 p-4 sm:p-5">
      <header class="flex flex-wrap items-center gap-3">
        <div class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <ActivityIcon class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-base font-semibold text-ink">{{ $t("app.hostMonitor") }}</h1>
          <p class="text-xs text-ink-muted">
            {{ $t("app.hostMonitorWindow") }} ·
            {{ $t("app.hostMonitorHostCount", { count: monitoredHosts.length }) }}
          </p>
        </div>
      </header>

      <div
        v-if="monitoredHosts.length"
        class="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2"
        data-testid="host-metrics-host-list"
      >
        <HostMetricsHostSection v-for="host in monitoredHosts" :key="host.id" :host-id="host.id" />
      </div>
      <div
        v-else
        class="grid min-h-64 place-items-center rounded-xl border border-dashed border-hairline text-sm text-ink-muted"
      >
        {{ $t("app.hostMetricsWaiting") }}
      </div>
    </div>
  </div>
</template>
