<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <div :class="cn('space-y-4 p-4 pt-0', props.class)" v-bind="$attrs">
    <slot />
  </div>
</template>
