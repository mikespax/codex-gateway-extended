<script setup lang="ts">
import { useTimestamp } from "@vueuse/core";
import { TargetIcon, XIcon } from "@lucide/vue";
import { computed, watch } from "vue";
import type { ThreadGoal } from "~~/shared/types";
import ComposerGoalDetailsDialog from "@/components/chat/composer/ComposerGoalDetailsDialog.vue";
import type { ComposerGoalPendingAction } from "@/composables/composer/useComposerGoalControls";
import { Button } from "@codex-gateway/ui/button";
import { formatGoalElapsed } from "@/utils/thread-goal-display";

const props = defineProps<{
  planModeActive: boolean;
  planSummary: string;
  goalInputActive: boolean;
  goal: ThreadGoal | null;
  goalObservedAt: number | null;
  goalActionPending: ComposerGoalPendingAction | null;
}>();

const emit = defineEmits<{
  deactivatePlan: [];
  saveGoal: [objective: string];
  stopGoal: [];
  resumeGoal: [];
  clearGoal: [];
}>();

const { timestamp: now, pause, resume } = useTimestamp({ controls: true, interval: 250 });

const currentGoal = computed(() => props.goal);
const goalElapsedSeconds = computed(() => {
  if (!currentGoal.value) {
    return 0;
  }
  const observedDelta =
    currentGoal.value.status === "active" && props.goalObservedAt
      ? Math.max(0, (now.value - props.goalObservedAt) / 1000)
      : 0;
  return currentGoal.value.timeUsedSeconds + observedDelta;
});

const goalTokensLabel = computed(() =>
  currentGoal.value ? `${currentGoal.value.tokensUsed.toLocaleString()} tokens` : "",
);
const goalBudgetLabel = computed(() => {
  const budget = currentGoal.value?.tokenBudget;
  return budget === null || budget === undefined ? "∞" : budget.toLocaleString();
});
const goalElapsedLabel = computed(() => formatGoalElapsed(goalElapsedSeconds.value));
const showGoalInputHint = computed(() => props.goalInputActive && !currentGoal.value);
const showStrip = computed(
  () => props.planModeActive || showGoalInputHint.value || currentGoal.value,
);

// A paused or blocked Goal remains actionable and visible. The composer controller removes a
// completed Goal from this presentation boundary, while only active Goals advance locally between
// app-server updates.
watch(
  () => currentGoal.value?.status === "active",
  (active) => (active ? resume() : pause()),
  { immediate: true },
);
</script>

<template>
  <div v-if="showStrip" data-testid="composer-mode-strip" class="mb-2 space-y-2">
    <div
      v-if="planModeActive"
      class="flex min-w-0 items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-ink shadow-sm shadow-ink/5 md:text-base"
    >
      <span class="shrink-0 font-medium text-primary">{{ $t("app.planModeActive") }}</span>
      <span v-if="planSummary" class="min-w-0 flex-1 truncate text-ink-secondary">
        {{ planSummary }}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="size-6 shrink-0 rounded-full text-primary hover:bg-primary/10"
        :aria-label="$t('app.deactivatePlanMode')"
        @click="emit('deactivatePlan')"
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>

    <div
      v-if="showGoalInputHint"
      class="gateway-goal-strip flex min-w-0 items-center gap-2 rounded-2xl border border-primary/55 bg-primary/15 px-3 py-2 text-sm text-ink shadow-sm shadow-primary/15 md:text-base"
    >
      <TargetIcon class="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span class="shrink-0 font-medium text-primary">{{ $t("app.goalModeActive") }}</span>
      <span class="min-w-0 truncate text-ink-secondary">{{ $t("app.goalInputHint") }}</span>
    </div>

    <ComposerGoalDetailsDialog
      v-if="currentGoal"
      :goal="currentGoal"
      :elapsed-label="goalElapsedLabel"
      :tokens-label="goalTokensLabel"
      :budget-label="goalBudgetLabel"
      :pending-action="goalActionPending"
      @save="emit('saveGoal', $event)"
      @stop="emit('stopGoal')"
      @resume="emit('resumeGoal')"
      @clear="emit('clearGoal')"
    />
  </div>
</template>
