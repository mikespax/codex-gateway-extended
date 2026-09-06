<script setup lang="ts">
import { CheckCircle2Icon, CircleIcon, ClockIcon, ListTodoIcon } from "@lucide/vue";
import { computed } from "vue";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import PlanImplementationActions from "./PlanImplementationActions.vue";
import type { ThreadHistoryItem } from "~~/shared/types";
import { recordFromUnknown } from "~~/shared/utils/records";
import CodexPlanCard from "./CodexPlanCard.vue";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  threadId: string | null;
}>();
const { t } = useI18n();

const steps = computed(() => (Array.isArray(props.item.plan) ? props.item.plan : []));

function stepStatus(step: unknown) {
  const status = recordFromUnknown(step)?.status;
  return typeof status === "string" ? status : "pending";
}
</script>

<template>
  <CodexPlanCard :title="t('app.todoPlan')">
    <template #icon>
      <ListTodoIcon class="size-4" />
    </template>
    <MarkdownContent v-if="item.explanation" :content="item.explanation" compact />
    <div v-if="steps.length" class="mt-3 space-y-2">
      <div
        v-for="(step, index) in steps"
        :key="`${index}-${step.step}`"
        class="flex items-start gap-2 text-sm leading-6"
      >
        <CheckCircle2Icon
          v-if="stepStatus(step) === 'completed'"
          class="mt-1 size-4 shrink-0 text-accent-green"
        />
        <ClockIcon
          v-else-if="stepStatus(step) === 'inProgress'"
          class="mt-1 size-4 shrink-0 text-primary"
        />
        <CircleIcon v-else class="mt-1 size-4 shrink-0 text-ink-faint" />
        <span class="min-w-0 flex-1">{{ step.step }}</span>
      </div>
    </div>
    <template #footer>
      <PlanImplementationActions :item="item" :host-id="hostId" :thread-id="threadId" />
    </template>
  </CodexPlanCard>
</template>
