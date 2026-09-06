<script setup lang="ts">
import type { IDockviewPanelProps } from "dockview-vue";
import HostMetricsPanel from "@/components/host-metrics/HostMetricsPanel.vue";
import type { WorkspaceDockPanelParamsFor } from "./types";

defineProps<{
  params: IDockviewPanelProps<WorkspaceDockPanelParamsFor<"hostMetrics">>;
}>();
</script>

<template>
  <HostMetricsPanel :host-id="params.params.hostId" />
</template>
