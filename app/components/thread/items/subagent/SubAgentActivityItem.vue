<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { GitBranchIcon } from "@lucide/vue";
import { computed } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { useOpenSubAgentPanel } from "@/composables/thread/useOpenSubAgentPanel";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { subAgentDisplayName } from "@/components/thread/subagent/display-name";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
}>();
const { t } = useI18n();
const threadView = useGatewayThreadViewStore();
const { openSubAgentPanel } = useOpenSubAgentPanel();

const title = computed(() => {
  const threadId = String(props.item.agentThreadId || "");
  const thread = props.hostId
    ? threadView.threadViews[pinnedKey(props.hostId, threadId)]?.currentThread
    : null;
  return subAgentDisplayName({
    thread,
    agentPath: props.item.agentPath,
    threadId,
    fallback: t("app.subAgentPanel"),
  });
});

function openSubAgent() {
  if (!props.hostId || !props.item.agentThreadId) {
    return;
  }
  void openSubAgentPanel({
    hostId: props.hostId,
    threadId: String(props.item.agentThreadId),
    titleCandidate: props.item.agentPath,
  });
}
</script>

<template>
  <Button
    v-if="item.agentThreadId"
    type="button"
    variant="ghost"
    class="h-auto w-full max-w-4xl justify-start rounded-xl px-2 py-2 text-left text-ink-secondary hover:bg-canvas-soft"
    data-testid="open-subagent-panel"
    @click="openSubAgent"
  >
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2 text-[0.9375rem]">
        <GitBranchIcon class="size-4 text-ink-muted" />
        <span class="min-w-0 truncate">{{ title }}</span>
        <Badge v-if="item.kind" variant="secondary">{{ item.kind }}</Badge>
        <Badge variant="outline" class="ml-auto">{{ t("app.openSubAgent") }}</Badge>
      </div>
      <div class="mt-1 truncate font-mono text-xs text-ink-faint">
        {{ item.agentThreadId }}
      </div>
    </div>
  </Button>

  <div v-else class="max-w-4xl text-ink-secondary">
    <div class="flex items-center gap-2 text-[0.9375rem]">
      <GitBranchIcon class="size-4 text-ink-muted" />
      <span class="min-w-0 truncate">{{ title }}</span>
      <Badge v-if="item.kind" variant="secondary">{{ item.kind }}</Badge>
    </div>
  </div>
</template>
