<script setup lang="ts">
import { ChevronDownIcon } from "@lucide/vue";
import ThreadRow from "./ThreadRow.vue";
import { formatRelative, threadKey } from "../sidebar-utils";
import type { ThreadActivitySummary } from "@/stores/gateway-thread-activity";
import type { ThreadRuntimeStatus } from "@/stores/gateway/types";

type RecentThread = ThreadActivitySummary & {
  id: string;
  hostName: string | null;
  status: ThreadRuntimeStatus;
  completionAttention: boolean;
  pinned: boolean;
};

const props = defineProps<{
  threads: RecentThread[];
  selectedHostId: number | null;
  selectedThreadId: string | null;
  longPressHandlers?: Record<string, unknown>;
  resourceUsageForHost?: (hostId: number) => string | null;
  expanded: boolean;
  moveHostLabel?: string;
}>();

const emit = defineEmits<{
  open: [thread: RecentThread];
  pin: [thread: RecentThread];
  rename: [thread: RecentThread];
  moveHost: [thread: RecentThread];
  toggle: [];
}>();

function subtitle(thread: RecentThread) {
  return thread.hostName || formatRelative(thread.updatedAt);
}
</script>

<template>
  <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
    <button
      class="flex h-8 w-full items-center justify-between gap-2 rounded px-2 pb-2 text-left text-sm text-ink-muted hover:bg-surface"
      :aria-expanded="props.expanded"
      @click="emit('toggle')"
    >
      <span>
        {{ $t("app.recentChats") }}
        <span class="text-xs text-ink-faint">({{ props.threads.length }})</span>
      </span>
      <ChevronDownIcon
        class="size-4 transition-transform"
        :class="{ '-rotate-90': !props.expanded }"
      />
    </button>
    <div v-if="props.expanded && props.threads.length" class="space-y-1">
      <ThreadRow
        v-for="thread in props.threads"
        :key="threadKey(thread.hostId, thread.threadId)"
        :thread="thread"
        :test-id="`recent-thread-button-${thread.threadId}`"
        :selected="
          thread.hostId === props.selectedHostId && thread.threadId === props.selectedThreadId
        "
        :status="thread.status"
        :completion-attention="thread.completionAttention"
        :subtitle="subtitle(thread)"
        :thread-bytes="thread.threadBytes"
        :resource-usage="props.resourceUsageForHost?.(thread.hostId)"
        :pin-label="thread.pinned ? $t('app.unpinThread') : $t('app.pinThread')"
        :show-pinned-icon="thread.pinned"
        :move-host-label="props.moveHostLabel"
        :long-press-handlers="props.longPressHandlers"
        @open="emit('open', thread)"
        @toggle-pin="emit('pin', thread)"
        @move-host="emit('moveHost', thread)"
        @rename="emit('rename', thread)"
      />
    </div>
    <div v-else-if="props.expanded" class="px-2 text-xs text-ink-faint">
      {{ $t("app.noRecentChats") }}
    </div>
  </section>
</template>
