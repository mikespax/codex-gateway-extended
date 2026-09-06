<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import type { HTMLAttributes } from "vue";
import { nextTick, onMounted, ref, watch } from "vue";
import ChatVirtualScrollFrame from "./ChatVirtualScrollFrame.vue";
import { useStickToBottom } from "./stick-to-bottom";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    viewportClass?: HTMLAttributes["class"];
    contentClass?: HTMLAttributes["class"];
    allowHorizontalOverflow?: boolean;
    threshold?: number;
    followKey?: unknown;
  }>(),
  {
    threshold: 120,
  },
);

const scrollFrameRef = ref<InstanceType<typeof ChatVirtualScrollFrame> | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);

const sticky = useStickToBottom({
  getViewport: scrollViewport,
  threshold: () => props.threshold,
  scrollToBottom: (viewport) => {
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  },
});

function scrollViewport() {
  return viewportRef.value ?? scrollFrameRef.value?.getViewport() ?? null;
}

useResizeObserver(contentRef, () => sticky.followContentChange());
// Content observation covers streaming rows and virtual measurements, but it cannot see a Dockview
// group or mobile visual viewport resize when the content height itself is unchanged. Observe the
// actual scroll viewport as well so an attached reader is corrected in the first ResizeObserver
// delivery instead of waiting for a later virtual-row reflow. Reuse the same stick-to-bottom state:
// followContentChange() is deliberately a no-op after the user detaches, so this must not become a
// separate resize-specific follow flag or scroll compensation path.
useResizeObserver(viewportRef, () => sticky.followContentChange());

watch(
  () => props.followKey,
  async () => {
    await nextTick();
    sticky.followContentChange();
  },
  { flush: "post" },
);

onMounted(() => {
  sticky.bindInputListeners();
  sticky.reset();
  void sticky.settleAndStick();
});

function handleViewportReady(viewport: HTMLElement) {
  viewportRef.value = viewport;
  sticky.bindInputListeners();
  sticky.stickIfFollowing();
}
</script>

<template>
  <ChatVirtualScrollFrame
    ref="scrollFrameRef"
    :class="props.class"
    :allow-horizontal-overflow="props.allowHorizontalOverflow"
    :viewport-class="
      props.allowHorizontalOverflow ? ['overflow-auto', props.viewportClass] : props.viewportClass
    "
    @viewport-ready="handleViewportReady"
  >
    <div
      ref="contentRef"
      :class="[props.allowHorizontalOverflow ? 'min-w-full w-max' : 'w-full', props.contentClass]"
    >
      <slot />
    </div>
  </ChatVirtualScrollFrame>
</template>
