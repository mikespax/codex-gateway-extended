<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import type { ThreadRuntimeStatus, ThreadTimelineTurn } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import ThreadTimelineRowView from "@/components/thread/ThreadTimelineRowView.vue";
import VirtualTimelineViewport from "@/components/thread/VirtualTimelineViewport.vue";
import {
  buildThreadTimelineRows,
  estimateThreadTimelineRow,
  reuseUnchangedTimelineRows,
  type ThreadTimelineRow,
} from "@/components/thread/timeline-rows";
import { buildThreadTurnSections } from "@/components/thread/thread-turn-sections";
import { useIntermediateStepsDisclosure } from "@/components/thread/useIntermediateStepsDisclosure";
import { provideFilePreviewContext } from "@/composables/files/useFilePreviewContext";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { collaborationModeFromThreadSettings } from "@/utils/thread-collaboration-mode";

const props = defineProps<{
  threadId: string | null;
  threadStatus: ThreadRuntimeStatus;
  turns: ThreadTimelineTurn[];
  hostId: number | null;
  projectId?: number | null;
  workspaceRoot?: string | null;
  loading: boolean;
  loadingOlder: boolean;
  olderTurnsCursor: string | null;
  scrollToLatestToken?: number;
}>();

const emit = defineEmits<{
  loadOlder: [];
}>();

const { t } = useI18n();
const composer = useGatewayComposerStore();
const userDetachedFromLatest = ref(false);
const timelineViewport = ref<InstanceType<typeof VirtualTimelineViewport> | null>(null);
const projectId = computed(() => props.projectId ?? null);
const planModeActive = computed(() => selectedThreadMode() === "plan");
const threadIsRunning = computed(() => props.threadStatus === "running");

provideFilePreviewContext({
  hostId: toRef(props, "hostId"),
  projectId,
  threadId: toRef(props, "threadId"),
  workspaceRoot: computed(() => props.workspaceRoot ?? null),
});

const turnStates = computed(() => {
  const states = props.turns.map((turn) => ({
    turn,
    sections: buildThreadTurnSections(turn, { planModeActive: planModeActive.value }),
  }));
  // Reconnected history can retain stale in-progress item flags for an old turn. Only the newest
  // active candidate may drive live spinners and elapsed timers, and only while the authoritative
  // thread runtime is running. This prevents historical steps from counting forever.
  let currentActiveIndex = -1;
  if (threadIsRunning.value) {
    states.forEach((state, index) => {
      if (state.sections.turnIsActive) currentActiveIndex = index;
    });
  }
  return states.map((state, index) => ({
    ...state,
    sections: {
      ...state.sections,
      turnIsActive: index === currentActiveIndex,
    },
  }));
});
const disclosureTurns = computed(() =>
  turnStates.value.map(({ turn, sections }) => ({
    id: turn.id,
    status: turn.status,
    items: sections.items,
    turnIsActive: sections.turnIsActive,
    hasPendingApproval: sections.items.some((item) => item.pendingApproval != null),
  })),
);
const { isIntermediateOpen, setIntermediateOpen } = useIntermediateStepsDisclosure({
  turns: disclosureTurns,
  threadIsRunning,
});
const activeIntermediateIsOpen = computed(() =>
  disclosureTurns.value.some((turn) => turn.turnIsActive && isIntermediateOpen(turn.id)),
);
const rows = computed<ThreadTimelineRow[]>((previous) => {
  const timelineTurns = turnStates.value.map(({ turn, sections }) => ({
    turn,
    sections,
    intermediateOpen: isIntermediateOpen(turn.id),
  }));
  // The disclosure controller owns intermediate-step visibility: active turns start expanded and
  // settle closed when their turn completes, while an explicit reader choice always wins. Footer
  // actions consume that result instead of treating one turn/completed event as the end of a Goal
  // or an automatic continuation. Requiring every disclosure to be closed keeps the actions hidden
  // while intermediate work is still visible.
  const agentActionsAvailable =
    !threadIsRunning.value && timelineTurns.every((turn) => !turn.intermediateOpen);
  const next = buildThreadTimelineRows({
    threadId: props.threadId,
    turns: timelineTurns,
    agentActionsAvailable,
  });
  // A streaming delta invalidates the row list but normally changes only one item. Preserve all
  // other row identities so Vue and Markdown renderers do not repeat work inside the virtual
  // viewport; TanStack can then measure only the row whose content actually changed.
  return reuseUnchangedTimelineRows(previous, next);
});

function selectedThreadMode() {
  if (!props.hostId || !props.threadId) return "default";
  return collaborationModeFromThreadSettings(
    composer.threadSettingsByKey[`${props.hostId}:${props.threadId}`],
  );
}

function handleReachStart() {
  if (props.olderTurnsCursor && !props.loadingOlder) emit("loadOlder");
}

function handleUserDetachedChange(detached: boolean) {
  userDetachedFromLatest.value = detached;
}

function handleIntermediateToggle(turnId: string, open: boolean) {
  setIntermediateOpen(turnId, open);
  // Opening active work is an explicit request to watch it. Reclaim the latest edge once, then
  // TanStack follows subsequent streaming and measurement updates until the reader scrolls away.
  if (open && threadIsRunning.value) timelineViewport.value?.scrollToLatest();
}

function estimateRowSize(row: unknown) {
  return estimateThreadTimelineRow(row as ThreadTimelineRow | undefined);
}

function timelineRow(row: unknown) {
  return row as ThreadTimelineRow;
}

watch(
  [rows, threadIsRunning, activeIntermediateIsOpen],
  ([, running, intermediateOpen]) => {
    // Expanded live work is a deliberate "watch" mode. Ask the viewport to reclaim the latest
    // edge after every rendered delta so dynamic terminal cards and measurements cannot strand
    // the newest step below the composer. A reader who scrolls away owns that position; their
    // explicit detachment always wins and stops these requests.
    if (!running || !intermediateOpen || userDetachedFromLatest.value) return;
    timelineViewport.value?.scrollToLatest();
  },
  { flush: "post" },
);

watch(
  () => props.threadId,
  () => {
    // Detachment belongs to the conversation being read, so it must not leak into the next
    // thread's disclosure policy. Scroll initialization is deliberately absent here: the keyed
    // viewport below owns its one official TanStack initial-layout transaction.
    userDetachedFromLatest.value = false;
  },
);
</script>

<template>
  <!--
    Key the viewport by thread so each conversation gets one clean TanStack Chat lifecycle.
    Do not also watch threadId and imperatively reset the child: after a keyed replacement the ref
    already points at the new viewport, so a parent reset would duplicate its initial layout scroll.
  -->
  <VirtualTimelineViewport
    :key="threadId ?? 'empty-thread'"
    ref="timelineViewport"
    :rows="rows"
    :estimate-size="estimateRowSize"
    :scroll-to-latest-token="scrollToLatestToken"
    @reach-start="handleReachStart"
    @user-detached-change="handleUserDetachedChange"
  >
    <template #overlay="{ visible }">
      <div v-if="olderTurnsCursor && visible" class="pointer-events-auto flex justify-center pt-2">
        <Button
          data-testid="load-older-turns-button"
          variant="outline"
          size="sm"
          :disabled="loadingOlder"
          @click="emit('loadOlder')"
        >
          {{ loadingOlder ? t("app.loadingOlder") : t("app.loadOlder") }}
        </Button>
      </div>
    </template>

    <template #default="{ row }">
      <ThreadTimelineRowView
        :row="timelineRow(row)"
        :host-id="hostId"
        :thread-id="threadId"
        @intermediate-toggle="handleIntermediateToggle"
      />
    </template>
  </VirtualTimelineViewport>
</template>
