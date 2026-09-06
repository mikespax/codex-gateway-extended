<script setup lang="ts">
import IntermediateStepsToggle from "@/components/thread/IntermediateStepsToggle.vue";
import IntermediateWorkingStatus from "@/components/thread/IntermediateWorkingStatus.vue";
import ThreadItemView from "@/components/thread/ThreadItemView.vue";
import TurnDurationLabel from "@/components/thread/TurnDurationLabel.vue";
import type { ThreadTimelineRow } from "@/components/thread/timeline-rows";

const props = defineProps<{
  row: ThreadTimelineRow;
  hostId: number | null;
  threadId: string | null;
}>();

const emit = defineEmits<{
  intermediateToggle: [turnId: string, open: boolean];
}>();

// Read the reactive row directly. App-server stream reducers update nested item proxies in place;
// cloning them into a presentation snapshot hides those deltas from Vue and prevents TanStack's
// ResizeObserver from seeing the new height. TanStack owns mounting and position, not data flow.
</script>

<template>
  <IntermediateStepsToggle
    v-if="props.row.type === 'intermediateHeader'"
    :open="props.row.open"
    :count="props.row.count"
    :preview="props.row.preview"
    :segment-number="props.row.segmentNumber"
    :segment-count="props.row.segmentCount"
    :working="props.row.working"
    :started-at="props.row.startedAt"
    :latest-operation="props.row.latestOperation"
    :footer="props.row.footer"
    @toggle="emit('intermediateToggle', props.row.turnId, $event)"
  />
  <ThreadItemView
    v-else-if="props.row.type === 'item'"
    :item="props.row.item"
    :section="props.row.section"
    :host-id="hostId"
    :thread-id="threadId"
    :user-message-variant="props.row.userMessageVariant"
    :turn-timing="props.row.turnTiming"
    :agent-actions-available="props.row.agentActionsAvailable"
    :sent-at="props.row.sentAt"
    :turn-is-active="props.row.turnIsActive"
  />
  <IntermediateWorkingStatus
    v-else-if="props.row.type === 'workingStatus'"
    :started-at="props.row.startedAt"
    :latest-operation="props.row.latestOperation"
  />
  <TurnDurationLabel v-else :timing="props.row" />
</template>
