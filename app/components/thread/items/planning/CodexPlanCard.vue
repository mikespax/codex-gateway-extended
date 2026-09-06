<script setup lang="ts">
import { ListChecksIcon } from "@lucide/vue";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@codex-gateway/ai-elements/plan";

defineProps<{
  title: string;
  isStreaming?: boolean;
}>();
</script>

<template>
  <Plan
    :default-open="true"
    :is-streaming="isStreaming"
    class="max-w-4xl border-hairline bg-surface text-ink-secondary"
  >
    <PlanHeader class="items-center gap-3 px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <slot name="icon">
          <ListChecksIcon class="size-4 shrink-0" />
        </slot>
        <PlanTitle class="truncate text-[0.9375rem] font-medium">{{ title }}</PlanTitle>
      </div>
      <PlanAction>
        <PlanTrigger :aria-label="$t('app.togglePlan')" />
      </PlanAction>
    </PlanHeader>
    <PlanContent class="px-4 pb-4 text-[0.9375rem] leading-7">
      <slot />
    </PlanContent>
    <slot name="footer" />
  </Plan>
</template>
