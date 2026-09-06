<script setup lang="ts">
import { useTimestamp } from "@vueuse/core";
import { computed } from "vue";
import { formatDurationMs } from "@/utils/item-timing";
import { resolvedTurnDurationMs } from "@/utils/turn-timing";

const props = defineProps<{
  startedAt: number | null;
  testId?: string;
}>();
const now = useTimestamp({ interval: 1000 });
const elapsedLabel = computed(() => {
  const elapsedMs = resolvedTurnDurationMs(
    { startedAt: props.startedAt, completedAt: null, durationMs: null },
    now.value,
  );
  return elapsedMs === null ? null : formatDurationMs(elapsedMs);
});
</script>

<template>
  <span
    v-if="elapsedLabel !== null"
    :data-testid="props.testId"
    class="rounded-full bg-surface/80 px-2 py-0.5 font-mono text-[0.6875rem] text-ink-secondary"
  >
    {{ elapsedLabel }}
  </span>
</template>
