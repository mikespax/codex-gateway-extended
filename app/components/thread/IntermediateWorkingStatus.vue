<script setup lang="ts">
import { Loader } from "@codex-gateway/ai-elements/loader";
import TurnElapsedPill from "@/components/thread/TurnElapsedPill.vue";

const props = defineProps<{
  startedAt: number | null;
  latestOperation: string | null;
}>();
const { t } = useI18n();
</script>

<template>
  <div
    data-testid="intermediate-working-status"
    class="flex max-w-4xl flex-col items-stretch gap-0 py-1 text-[0.9375rem] text-ink-muted"
    role="status"
    aria-live="polite"
  >
    <div class="flex w-full min-w-0 items-center gap-2">
      <Loader class="size-4 shrink-0 text-primary" />
      <span>{{ t("app.working") }}</span>
      <TurnElapsedPill
        class="ml-auto"
        :started-at="props.startedAt"
        test-id="intermediate-working-duration"
      />
    </div>
    <div
      v-if="props.latestOperation"
      data-testid="intermediate-latest-operation"
      class="w-full min-w-0 truncate pl-6 text-xs text-ink-faint"
      :aria-label="props.latestOperation"
      :title="props.latestOperation"
    >
      {{ props.latestOperation }}
    </div>
  </div>
</template>
