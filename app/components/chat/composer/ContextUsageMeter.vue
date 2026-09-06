<script setup lang="ts">
import { computed } from "vue";
import type { ThreadTokenUsageState } from "~~/shared/types";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextIcon,
  ContextTrigger,
} from "@codex-gateway/ai-elements/context";
import { Button } from "@codex-gateway/ui/button";
import { projectContextUsage } from "./context-usage-display";

const props = defineProps<{
  tokenUsage: ThreadTokenUsageState | null;
}>();

const { locale, t } = useI18n();
const usage = computed(() => projectContextUsage(props.tokenUsage));
const accessibleLabel = computed(() =>
  usage.value === null
    ? t("app.contextUsageUnavailable")
    : t("app.contextUsage", { percent: usage.value.percent }),
);
const detailRows = computed(() => {
  const value = usage.value;
  if (value === null) return [];
  return [
    { label: t("app.contextInputTokens"), value: value.inputTokens },
    { label: t("app.contextOutputTokens"), value: value.outputTokens },
    { label: t("app.contextReasoningTokens"), value: value.reasoningTokens },
    { label: t("app.contextCacheReadTokens"), value: value.cacheReadTokens },
    { label: t("app.contextCacheWriteTokens"), value: value.cacheWriteTokens },
  ];
});

function formatTokens(value: number) {
  return new Intl.NumberFormat(locale.value).format(value);
}
</script>

<template>
  <Context v-if="usage !== null" :used-tokens="usage.usedTokens" :max-tokens="usage.maxTokens">
    <ContextTrigger>
      <Button
        data-testid="context-usage-meter"
        type="button"
        variant="ghost"
        size="sm"
        class="shrink-0 gap-2 px-1.5 text-base font-normal text-ink-muted hover:bg-canvas-soft"
        :title="accessibleLabel"
        :aria-label="accessibleLabel"
      >
        <ContextIcon class="size-6" />
        <span class="hidden sm:inline">{{ usage.percent }}%</span>
      </Button>
    </ContextTrigger>
    <ContextContent align="end" class="w-72 border-hairline">
      <ContextContentHeader />
      <ContextContentBody class="space-y-2">
        <div
          v-for="row in detailRows"
          :key="row.label"
          class="flex items-center justify-between gap-4 text-xs"
        >
          <span class="text-ink-muted">{{ row.label }}</span>
          <span class="font-mono text-ink-secondary">{{ formatTokens(row.value) }}</span>
        </div>
      </ContextContentBody>
    </ContextContent>
  </Context>
</template>
