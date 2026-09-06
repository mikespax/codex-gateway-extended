<script setup lang="ts">
import { GaugeIcon } from "@lucide/vue";
import { useIntervalFn } from "@vueuse/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CodexRateLimitSummary } from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";

const props = defineProps<{
  hostId: number | null;
}>();

const { t } = useI18n();
const usage = ref<CodexRateLimitSummary | null>(null);
let requestGeneration = 0;

const primaryWindow = computed(() => usage.value?.primary ?? usage.value?.secondary ?? null);
const remainingPercent = computed(() => primaryWindow.value?.remainingPercent ?? null);
const accessibleLabel = computed(() =>
  remainingPercent.value === null
    ? t("app.codexUsageUnavailable")
    : t("app.codexUsageAvailable", { percent: remainingPercent.value }),
);
const toneClass = computed(() => {
  const percent = remainingPercent.value;
  if (percent === null || percent > 40) return "text-accent-green";
  if (percent > 15) return "text-accent-orange-deep";
  return "text-destructive";
});

async function refresh() {
  const hostId = props.hostId;
  const generation = ++requestGeneration;
  if (hostId === null) {
    usage.value = null;
    return;
  }
  try {
    const next = await gatewayApi<CodexRateLimitSummary>(`/api/hosts/${hostId}/codex-usage`);
    if (generation === requestGeneration && props.hostId === hostId) usage.value = next;
  } catch {
    if (generation === requestGeneration) usage.value = null;
  }
}

const { pause, resume } = useIntervalFn(() => void refresh(), 60_000, { immediate: false });

onMounted(() => {
  void refresh();
  resume();
});

watch(
  () => props.hostId,
  () => void refresh(),
);

onBeforeUnmount(pause);
</script>

<template>
  <div
    v-if="remainingPercent !== null"
    data-testid="codex-usage-badge"
    role="status"
    class="flex h-7 shrink-0 items-center gap-1 rounded-md bg-canvas-soft px-1.5 text-[0.6875rem] font-semibold tabular-nums"
    :class="toneClass"
    :title="accessibleLabel"
    :aria-label="accessibleLabel"
  >
    <GaugeIcon class="size-3.5" aria-hidden="true" />
    <span>{{ remainingPercent }}%</span>
  </div>
</template>
