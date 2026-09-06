<script setup lang="ts">
import { FolderIcon, Loader2Icon } from "@lucide/vue";
import { computed } from "vue";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatPanelScrollArea from "@/components/chat/ChatPanelScrollArea.vue";
import ProjectThreadList from "@/components/chat/ProjectThreadList.vue";
import ThreadVirtualTimeline from "@/components/thread/ThreadVirtualTimeline.vue";
import ActiveSubAgentsBar from "@/components/thread/subagent/ActiveSubAgentsBar.vue";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useChatWorkspaceState } from "./chat-workspace-state";

const {
  initializing,
  openingThread,
  selectedThreadId,
  selectedThreadStatus,
  selectedProjectId,
  selectedHostId,
  currentThread,
  historyTurns,
  loading,
  loadingOlderTurns,
  olderTurnsCursor,
  scrollToLatestToken,
  visibleError,
  selectedThreadViewReady,
} = useChatWorkspaceState();
const threadTurns = useGatewayThreadTurnsStore();

const { t } = useI18n();
const showThreadLoading = computed(
  () =>
    initializing.value ||
    openingThread.value ||
    (Boolean(selectedThreadId.value) && !selectedThreadViewReady.value && !visibleError.value),
);
</script>

<template>
  <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <div data-testid="chat-main-pane" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ActiveSubAgentsBar
        v-if="selectedThreadId"
        :turns="historyTurns"
        :host-id="selectedHostId"
        :parent-thread-id="selectedThreadId"
      />
      <ChatPanelScrollArea
        v-if="showThreadLoading"
        class="flex items-center justify-center text-[0.9375rem] text-ink-muted"
      >
        <div class="flex items-center gap-2">
          <Loader2Icon class="size-4 animate-spin" />
          <span>{{ t("app.loadingGateway") }}</span>
        </div>
      </ChatPanelScrollArea>

      <ThreadVirtualTimeline
        v-else-if="selectedThreadId"
        :thread-id="selectedThreadId"
        :thread-status="selectedThreadStatus"
        :turns="historyTurns"
        :host-id="selectedHostId"
        :project-id="selectedProjectId"
        :workspace-root="currentThread?.cwd ?? null"
        :loading="loading"
        :loading-older="loadingOlderTurns"
        :older-turns-cursor="olderTurnsCursor"
        :scroll-to-latest-token="scrollToLatestToken"
        @load-older="threadTurns.loadOlderTurns"
      />

      <ChatPanelScrollArea v-else-if="selectedProjectId">
        <ProjectThreadList />
      </ChatPanelScrollArea>

      <ChatPanelScrollArea v-else class="flex items-start">
        <div
          class="max-w-3xl rounded-2xl bg-canvas-soft px-4 py-3 text-[0.9375rem] leading-7 text-ink md:ml-auto md:px-5 md:py-4"
        >
          <div class="mb-2 flex items-center gap-2 text-ink-muted">
            <FolderIcon class="size-4" />
            {{ selectedProjectId ? t("app.selectThreadFirst") : t("app.selectProjectFirst") }}
          </div>
          {{ selectedProjectId ? t("app.noThread") : t("app.chooseProject") }}
        </div>
      </ChatPanelScrollArea>

      <ChatComposer v-if="selectedThreadId || selectedProjectId" />
    </div>
  </div>
</template>
