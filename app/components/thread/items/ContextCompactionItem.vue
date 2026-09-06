<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { useTimestamp } from "@vueuse/core";
import { ArchiveIcon, CheckCircle2Icon, Loader2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Checkpoint, CheckpointIcon } from "@codex-gateway/ai-elements/checkpoint";
import { isItemInProgress } from "@/utils/thread-items";
import { formatDurationMs, itemCompletedAtMs, itemStartedAtMs } from "@/utils/item-timing";

const props = defineProps<{ item: ThreadHistoryItem; live?: boolean }>();

const { t } = useI18n();
const { timestamp: now, pause, resume } = useTimestamp({ controls: true, interval: 100 });
const localStartedAt = ref(Date.now());

const inProgress = computed(() => props.live !== false && isItemInProgress(props.item));
const startedAt = computed(() => itemStartedAtMs(props.item) ?? localStartedAt.value);
const completedAt = computed(() => itemCompletedAtMs(props.item));
const elapsedMs = computed(
  () => (inProgress.value ? now.value : (completedAt.value ?? now.value)) - startedAt.value,
);
const hasReliableCompletedTiming = computed(() =>
  Boolean(itemStartedAtMs(props.item) && itemCompletedAtMs(props.item)),
);
const timeLabel = computed(() => {
  if (!inProgress.value && !hasReliableCompletedTiming.value) {
    return t("app.completed");
  }
  return formatDurationMs(elapsedMs.value);
});

watch(inProgress, (active) => (active ? resume() : pause()), { immediate: true });
</script>

<template>
  <Checkpoint class="max-w-4xl gap-2 py-1 text-[0.9375rem] text-ink-muted">
    <CheckpointIcon>
      <Loader2Icon v-if="inProgress" class="size-4 shrink-0 animate-spin text-primary" />
      <CheckCircle2Icon v-else class="size-4 shrink-0 text-accent-green" />
    </CheckpointIcon>
    <ArchiveIcon class="size-4 shrink-0" />
    <span class="shrink-0">{{ t("app.contextCompaction") }}</span>
    <span class="shrink-0 font-mono text-xs text-ink-secondary">{{ timeLabel }}</span>
  </Checkpoint>
</template>
