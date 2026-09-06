<script setup lang="ts">
import { Loader2Icon } from "@lucide/vue";
import { computed } from "vue";
import type { ThreadTimelineTurn } from "~~/shared/types";
import type { SubAgentPanelState, ThreadViewState } from "@/stores/gateway/types";
import ThreadVirtualTimeline from "@/components/thread/ThreadVirtualTimeline.vue";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";

const props = defineProps<{
  panel: SubAgentPanelState;
  preview: ThreadViewState | null;
  turns: ThreadTimelineTurn[];
}>();

const { t } = useI18n();
const runtime = useGatewayThreadRuntimeStore();
const threadStatus = computed(
  () => runtime.threadRuntimeProjection(props.panel.hostId, props.panel.threadId).status,
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div
      v-if="preview?.loading && !turns.length"
      class="flex flex-1 items-center justify-center text-sm text-ink-muted"
    >
      <Loader2Icon class="mr-2 size-4 animate-spin" />
      {{ t("app.loadingSubAgent") }}
    </div>

    <ThreadVirtualTimeline
      v-else-if="turns.length"
      :thread-id="panel.threadId"
      :thread-status="threadStatus"
      :turns="turns"
      :host-id="panel.hostId"
      :project-id="null"
      :workspace-root="preview?.currentThread?.cwd ?? null"
      :loading="Boolean(preview?.loading)"
      :loading-older="false"
      :older-turns-cursor="null"
    />

    <div
      v-else
      class="flex flex-1 items-center justify-center px-4 text-center text-sm text-ink-muted"
    >
      {{ t("app.noSubAgentTurns") }}
    </div>
  </div>
</template>
