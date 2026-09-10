<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";

const props = withDefaults(
  defineProps<{
    text: string;
    title?: string | null;
    testId?: string;
  }>(),
  { testId: "thread-activity-summary" },
);

const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const overflowPixels = ref(0);
const MARQUEE_SPEED_MULTIPLIER = 1.3;

function measureOverflow() {
  void nextTick(() => {
    const viewportWidth = viewport.value?.clientWidth ?? 0;
    const contentWidth = content.value?.scrollWidth ?? 0;
    overflowPixels.value = Math.max(0, contentWidth - viewportWidth);
  });
}

useResizeObserver(viewport, measureOverflow);
watch(() => props.text, measureOverflow, { immediate: true });

const trackStyle = computed(() => ({
  "--gateway-sidebar-activity-distance": `${overflowPixels.value}px`,
  // Keep a consistent, deliberately slow pixel rate, then make every overflowing line 30% faster.
  // Scaling the whole duration preserves the same proportional pauses at either end.
  "--gateway-sidebar-activity-duration": `${Math.max(28, overflowPixels.value / 2) / MARQUEE_SPEED_MULTIPLIER}s`,
}));
</script>

<template>
  <span
    ref="viewport"
    :data-testid="props.testId"
    class="block min-w-0 flex-1 overflow-hidden text-[0.6875rem] text-ink-muted"
    :title="props.title ?? props.text"
    :aria-label="props.title ?? props.text"
  >
    <span
      ref="content"
      class="inline-block whitespace-nowrap"
      :class="{ 'gateway-sidebar-activity-marquee': overflowPixels > 0 }"
      :style="trackStyle"
    >
      {{ props.text }}
    </span>
  </span>
</template>

<style scoped>
@keyframes gateway-sidebar-activity-marquee {
  0%,
  12% {
    transform: translateX(0);
  }
  88%,
  100% {
    transform: translateX(calc(-1 * var(--gateway-sidebar-activity-distance)));
  }
}

.gateway-sidebar-activity-marquee {
  animation: gateway-sidebar-activity-marquee var(--gateway-sidebar-activity-duration) linear
    infinite;
}

@media (prefers-reduced-motion: reduce) {
  .gateway-sidebar-activity-marquee {
    animation: none;
  }
}
</style>
