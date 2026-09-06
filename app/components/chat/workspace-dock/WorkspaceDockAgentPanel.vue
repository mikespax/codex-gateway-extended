<script setup lang="ts">
import type { IDockviewPanelProps } from "dockview-vue";
import { onBeforeUnmount, onMounted, provide, ref } from "vue";
import { CHAT_VIEWPORT_LAYOUT_REVISION } from "@/components/common/chat-virtualizer";
import AgentWorkspacePane from "../AgentWorkspacePane.vue";

const props = defineProps<{ params: IDockviewPanelProps }>();
const layoutRevision = ref(0);
provide(CHAT_VIEWPORT_LAYOUT_REVISION, layoutRevision);

// Dockview is the semantic owner of panel geometry. Publish its public layout event instead of
// adding another DOM ResizeObserver inside the timeline. The mounted revision is important for a
// newly keyed workspace: child rows can measure before Dockview has committed the restored panel
// height, especially in mobile WebKit, so the first imperative end alignment must run once more
// after both the Vue renderer and Dockview dimensions exist.
const dimensionsSubscription = props.params.api.onDidDimensionsChange(() => {
  layoutRevision.value += 1;
});

onMounted(() => {
  if (props.params.api.width > 0 && props.params.api.height > 0) layoutRevision.value += 1;
});

onBeforeUnmount(() => dimensionsSubscription.dispose());
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <AgentWorkspacePane />
  </div>
</template>
