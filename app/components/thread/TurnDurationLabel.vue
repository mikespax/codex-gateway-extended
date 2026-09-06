<script setup lang="ts">
import { Clock3Icon } from "@lucide/vue";
import { useTimestamp } from "@vueuse/core";
import { computed, watch } from "vue";
import { formatDurationMs } from "@/utils/item-timing";
import { resolvedTurnDurationMs, type DisplayedTurnTiming } from "@/utils/turn-timing";

const props = defineProps<{ timing: DisplayedTurnTiming }>();
const { t } = useI18n();
const { timestamp: now, pause, resume } = useTimestamp({ controls: true, interval: 1000 });
const duration = computed(() => resolvedTurnDurationMs(props.timing, now.value));
const label = computed(() => (duration.value === null ? null : formatDurationMs(duration.value)));

// App-server owns the start/end instants. VueUse only advances the wall clock while a Turn is
// active; it never invents a start timestamp when the protocol has not supplied one.
watch(
  () => props.timing.active,
  (active) => (active ? resume() : pause()),
  { immediate: true },
);
</script>

<template>
  <span v-if="label !== null" class="inline-flex items-center gap-1.5 text-xs text-ink-faint">
    <Clock3Icon class="size-3.5" />
    <span>{{ t("app.turnDuration", { duration: label }) }}</span>
  </span>
</template>
