<script setup lang="ts">
import { TargetIcon } from "@lucide/vue";
import { computed } from "vue";
import type { ThreadGoalStatus } from "~~/shared/types";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import { Badge } from "@codex-gateway/ui/badge";
import {
  formatGoalElapsed,
  formatGoalTokens,
  goalStatusI18nKey,
} from "@/utils/thread-goal-display";

const props = defineProps<{
  item: {
    objective?: string;
    status?: ThreadGoalStatus;
    tokenBudget?: number | null;
    tokensUsed?: number;
    timeUsedSeconds?: number;
  };
}>();

const { t } = useI18n();

const status = computed(() => props.item.status ?? "active");
const statusLabel = computed(() => t(goalStatusI18nKey(status.value)));
const tokensLabel = computed(() => formatGoalTokens(props.item.tokensUsed ?? 0));
const budgetLabel = computed(() => {
  const budget = props.item.tokenBudget;
  return budget === null || budget === undefined ? "∞" : formatGoalTokens(budget);
});
const elapsedLabel = computed(() => formatGoalElapsed(props.item.timeUsedSeconds ?? 0));
</script>

<template>
  <article
    data-testid="thread-goal-item"
    class="gateway-goal-item max-w-4xl overflow-hidden rounded-2xl border bg-primary/10 text-sm text-ink shadow-sm shadow-primary/10"
  >
    <div class="flex flex-col gap-3 border-l-4 border-primary px-4 py-3 md:flex-row md:items-start">
      <div class="flex shrink-0 items-center gap-2 font-semibold text-primary md:w-24">
        <span
          class="flex size-7 items-center justify-center rounded-full bg-primary/20 ring-1 ring-primary/35"
        >
          <TargetIcon class="size-4" />
        </span>
        <span>{{ t("app.threadGoal") }}</span>
      </div>

      <div class="min-w-0 flex-1">
        <MarkdownContent
          v-if="item.objective"
          class="thread-goal-objective"
          :content="item.objective"
          compact
        />
      </div>

      <div
        class="flex shrink-0 flex-wrap items-center gap-2 text-xs text-ink-secondary md:w-44 md:flex-col md:items-end md:gap-1"
      >
        <Badge variant="outline" class="border-primary/55 bg-primary/15 font-semibold text-primary">
          {{ statusLabel }}
        </Badge>
        <span>{{ t("app.goalElapsed") }}: {{ elapsedLabel }}</span>
        <span>{{ t("app.goalTokensUsed") }}: {{ tokensLabel }}</span>
        <span>{{ t("app.goalTokenBudget") }}: {{ budgetLabel }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.thread-goal-objective :deep(.markdown-content),
.thread-goal-objective :deep(.markdown-content p),
.thread-goal-objective :deep(.markdown-content li),
.thread-goal-objective :deep(.markdown-content code),
.thread-goal-objective :deep(.markdown-content a) {
  overflow-wrap: anywhere;
}
</style>
