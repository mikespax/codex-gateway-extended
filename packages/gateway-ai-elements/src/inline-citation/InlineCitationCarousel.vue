<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Carousel } from "@codex-gateway/ui/carousel";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <Carousel :class="cn('w-full', props.class)">
    <slot />
  </Carousel>
</template>
