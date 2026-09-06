<script setup lang="ts">
import type { HTMLAttributes, StyleValue } from "vue";
import { nextTick, onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    viewportClass?: HTMLAttributes["class"];
    allowHorizontalOverflow?: boolean;
    style?: StyleValue;
  }>(),
  {
    allowHorizontalOverflow: false,
  },
);

const viewportRef = ref<HTMLElement | null>(null);
const emit = defineEmits<{
  viewportReady: [viewport: HTMLElement];
}>();

function getViewport() {
  return viewportRef.value;
}

onMounted(async () => {
  await nextTick();
  if (viewportRef.value) {
    emit("viewportReady", viewportRef.value);
  }
});

defineExpose({ getViewport });
</script>

<template>
  <div data-slot="scroll-area" :class="props.class" :style="props.style">
    <!-- A stable gutter makes native scrollbar-thumb intent measurable even in browsers that
         otherwise use overlay scrollbars. Do not replace this with a guessed edge width: that
         would detach bottom-follow for ordinary content clicks near the right edge. -->
    <div
      ref="viewportRef"
      data-slot="scroll-area-viewport"
      :class="[
        'h-full w-full [overflow-anchor:none] [scrollbar-gutter:stable]',
        props.allowHorizontalOverflow ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden',
        props.viewportClass,
      ]"
      @touchmove.stop
      @wheel.stop
    >
      <slot />
    </div>
  </div>
</template>
