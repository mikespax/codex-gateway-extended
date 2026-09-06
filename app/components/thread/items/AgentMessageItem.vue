<script setup lang="ts">
import type { ThreadHistoryItem, ThreadTurnUsageSummary } from "~~/shared/types";
import { computed } from "vue";
import { Message, MessageContent } from "@codex-gateway/ai-elements/message";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import AgentMessageActions from "@/components/thread/items/AgentMessageActions.vue";
import ThreadImageReferences from "@/components/thread/attachments/ThreadImageReferences.vue";
import MessageTimestamp from "@/components/thread/MessageTimestamp.vue";
import { isItemInProgress, threadItemText } from "@/utils/thread-items";
import type { DisplayedTurnTiming } from "@/utils/turn-timing";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  showInlineImages?: boolean;
  turnTiming?: DisplayedTurnTiming | null;
  turnUsage?: ThreadTurnUsageSummary | null;
  agentActionsAvailable?: boolean;
  sentAt?: number | string | null;
}>();

const text = computed(() => threadItemText(props.item));
const inProgress = computed(() => isItemInProgress(props.item));
const hasFooter = computed(
  () =>
    Boolean(text.value) &&
    (props.turnUsage != null || (props.turnTiming != null && props.agentActionsAvailable === true)),
);
</script>

<template>
  <Message from="assistant" class="min-w-0 max-w-full lg:max-w-4xl">
    <MessageContent
      class="min-w-0 w-full gap-0 overflow-visible leading-8 text-ink"
      style="font-size: var(--chat-message-font-size, 0.9375rem)"
    >
      <ThreadImageReferences
        :item="item"
        :host-id="hostId"
        :show="props.showInlineImages === true"
      />
      <MarkdownContent :content="text" :streaming="inProgress" />
      <MessageTimestamp
        v-if="props.sentAt != null && !inProgress"
        :value="props.sentAt"
        class="mt-3"
      />
      <AgentMessageActions
        v-if="hasFooter"
        :text="text"
        :turn-timing="turnTiming"
        :turn-usage="turnUsage"
      />
    </MessageContent>
  </Message>
</template>
