<script setup lang="ts">
import { CheckIcon, CopyIcon } from "@lucide/vue";
import { useClipboard } from "@vueuse/core";
import { toRef } from "vue";
import { MessageActions } from "@codex-gateway/ai-elements/message";
import { Button } from "@codex-gateway/ui/button";
import { toast } from "@codex-gateway/ui/sonner";
import TurnDurationLabel from "@/components/thread/TurnDurationLabel.vue";
import type { DisplayedTurnTiming } from "@/utils/turn-timing";

const props = defineProps<{
  text: string;
  turnTiming?: DisplayedTurnTiming | null;
}>();

const { t } = useI18n();
const { copy, copied, isSupported } = useClipboard({
  source: toRef(props, "text"),
  copiedDuring: 1200,
});

async function copyText() {
  if (!props.text || !isSupported.value) {
    toast.error(t("app.copyAgentOutputFailed"));
    return;
  }
  try {
    await copy();
    toast.success(t("app.agentOutputCopied"));
  } catch {
    toast.error(t("app.copyAgentOutputFailed"));
  }
}
</script>

<template>
  <!-- The parent mounts actions only after the existing intermediate-process disclosure closes. -->
  <MessageActions
    data-testid="agent-message-actions"
    class="mt-3 flex w-full items-center gap-2 border-t border-border/60 pt-2"
  >
    <TurnDurationLabel v-if="turnTiming" :timing="turnTiming" />
    <Button
      data-testid="copy-agent-response-button"
      type="button"
      variant="outline"
      size="default"
      class="ml-auto h-9 gap-2 px-3 text-ink-muted hover:bg-canvas-soft hover:text-ink"
      :title="t('app.copyAgentOutput')"
      :aria-label="t('app.copyAgentOutput')"
      @click="copyText"
    >
      <CheckIcon v-if="copied" class="size-4 text-accent-green" />
      <CopyIcon v-else class="size-4" />
      <span>{{ copied ? t("app.agentOutputCopied") : t("app.copyAgentOutput") }}</span>
    </Button>
  </MessageActions>
</template>
