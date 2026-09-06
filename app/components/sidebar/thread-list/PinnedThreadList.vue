<script setup lang="ts">
import ThreadRow from "./ThreadRow.vue";
import { formatRelative, pinnedThreadId, pinnedThreadKey } from "../sidebar-utils";
import type { HostRecord, PinnedThreadRecord } from "../sidebar-types";
import type { ThreadRuntimeStatus } from "@/stores/gateway/types";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";

const props = defineProps<{
  threads: PinnedThreadRecord[];
  hosts: HostRecord[];
  selectedHostId: number | null;
  selectedThreadId: string | null;
  longPressHandlers?: Record<string, unknown>;
  runtimeStatus: (thread: PinnedThreadRecord) => ThreadRuntimeStatus;
  completionAttention: (thread: PinnedThreadRecord) => boolean;
  resourceUsageForHost?: (hostId: number) => string | null;
  headerLabel?: string;
  showHeader?: boolean;
  moveLabel?: string;
  moveHostLabel?: string;
}>();

const emit = defineEmits<{
  open: [thread: PinnedThreadRecord];
  unpin: [thread: PinnedThreadRecord];
  rename: [thread: PinnedThreadRecord];
  move: [thread: PinnedThreadRecord];
  moveHost: [thread: PinnedThreadRecord];
}>();

const activity = useGatewayThreadActivityStore();

function subtitleForPinnedThread(thread: PinnedThreadRecord) {
  const hostName = props.hosts.find((host) => host.id === thread.hostId)?.name;
  return hostName || formatRelative(thread.updatedAt);
}

function isSelectedPinnedThread(thread: PinnedThreadRecord) {
  return (
    pinnedThreadId(thread) === String(props.selectedThreadId) &&
    thread.hostId === props.selectedHostId
  );
}

function threadBytes(thread: PinnedThreadRecord) {
  return activity.summariesByKey[pinnedKey(thread.hostId, String(thread.threadId))]?.threadBytes;
}
</script>

<template>
  <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
    <div
      v-if="props.showHeader !== false"
      class="flex h-8 items-center justify-between gap-2 px-2 pb-2 text-sm text-ink-muted"
    >
      <span>{{ props.headerLabel ?? $t("app.pinned") }}</span>
      <slot name="header-action" />
    </div>
    <div v-if="threads.length" class="space-y-1">
      <ThreadRow
        v-for="thread in threads"
        :key="pinnedThreadKey(thread)"
        :thread="thread"
        :test-id="`pinned-thread-button-${pinnedThreadId(thread)}`"
        :selected="isSelectedPinnedThread(thread)"
        :status="runtimeStatus(thread)"
        :completion-attention="completionAttention(thread)"
        :subtitle="subtitleForPinnedThread(thread) || formatRelative(thread.updatedAt)"
        :thread-bytes="threadBytes(thread)"
        :resource-usage="props.resourceUsageForHost?.(thread.hostId)"
        :pin-label="$t('app.unpinThread')"
        :move-label="props.moveLabel"
        :move-host-label="props.moveHostLabel"
        :long-press-handlers="longPressHandlers"
        show-pinned-icon
        @open="emit('open', thread)"
        @toggle-pin="emit('unpin', thread)"
        @move="emit('move', thread)"
        @move-host="emit('moveHost', thread)"
        @rename="emit('rename', thread)"
      />
    </div>
  </section>
</template>
