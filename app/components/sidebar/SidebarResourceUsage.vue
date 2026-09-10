<script setup lang="ts">
import { computed } from "vue";
import {
  parseSidebarResourceUsage,
  sidebarResourceToneForPercent,
} from "@/utils/sidebar-resource-usage";

const props = defineProps<{
  value?: string | null;
  testId?: string;
}>();

const metrics = computed(() => parseSidebarResourceUsage(props.value));
</script>

<template>
  <span
    v-if="props.value"
    :data-testid="props.testId"
    class="inline-flex min-w-0 items-center gap-1 text-xs"
    :title="props.value"
  >
    <template v-if="metrics.length">
      <template v-for="(metric, index) in metrics" :key="metric.key">
        <span v-if="index" class="text-ink-faint" aria-hidden="true">·</span>
        <span class="text-ink-muted">{{ metric.label }}</span>
        <span :class="sidebarResourceToneForPercent(metric.percent)">{{ metric.display }}</span>
      </template>
    </template>
    <span v-else class="truncate text-ink-muted">{{ props.value }}</span>
  </span>
</template>
