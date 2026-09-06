<script setup lang="ts">
import { BotIcon } from "@lucide/vue";
import { computed } from "vue";
import type { ThreadTimelineTurn } from "~~/shared/types";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { useOpenSubAgentPanel } from "@/composables/thread/useOpenSubAgentPanel";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { activeSubAgentsFromTurns } from "./active-subagents";
import { subAgentDisplayName } from "./display-name";
import { useActiveSubAgentMetadata } from "./useActiveSubAgentMetadata";

const props = defineProps<{
  turns: ThreadTimelineTurn[];
  hostId: number | null;
  parentThreadId: string;
}>();
const { t } = useI18n();
const threadView = useGatewayThreadViewStore();
const threadActivity = useGatewayThreadActivityStore();
const threadRuntime = useGatewayThreadRuntimeStore();
const { openSubAgentPanel } = useOpenSubAgentPanel();
const agents = computed(() => {
  const runtimeStatuses =
    props.hostId === null
      ? {}
      : Object.fromEntries(
          Object.entries(threadRuntime.threadStatuses)
            .filter(([key]) => key.startsWith(`${props.hostId}:`))
            .map(([key, status]) => [key.slice(`${props.hostId}:`.length), status]),
        );
  return activeSubAgentsFromTurns(props.turns, runtimeStatuses);
});
useActiveSubAgentMetadata(() => props.hostId, agents);

function displayName(agent: (typeof agents.value)[number]) {
  const thread = props.hostId
    ? threadView.threadViews[pinnedKey(props.hostId, agent.threadId)]?.currentThread
    : null;
  const summary = props.hostId
    ? threadActivity.summariesByKey[pinnedKey(props.hostId, agent.threadId)]
    : undefined;
  return subAgentDisplayName({
    thread: thread ?? summary,
    agentPath: agent.agentPath,
    threadId: agent.threadId,
    fallback: t("app.subAgentPanel"),
  });
}

function open(agent: (typeof agents.value)[number]) {
  void openSubAgentPanel({
    hostId: props.hostId,
    threadId: agent.threadId,
    titleCandidate: agent.agentPath,
    parentHostId: props.hostId,
    parentThreadId: props.parentThreadId,
  });
}
</script>

<template>
  <div
    v-if="agents.length"
    class="flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-hairline bg-canvas-soft/55 px-3"
    data-testid="active-subagents"
  >
    <div class="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
      <BotIcon class="size-3.5" />
      {{ $t("app.activeSubAgents") }}
      <Badge variant="secondary">{{ agents.length }}</Badge>
    </div>
    <Button
      v-for="agent in agents"
      :key="agent.threadId"
      variant="outline"
      size="sm"
      class="h-7 shrink-0 gap-1.5 px-2"
      :title="displayName(agent)"
      data-testid="open-active-subagent"
      @click="open(agent)"
    >
      <span class="max-w-40 truncate">{{ displayName(agent) }}</span>
      <span class="size-1.5 rounded-full bg-primary" />
    </Button>
  </div>
</template>
