<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@codex-gateway/ui/utils";

interface Props {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <div :class="cn('flex items-center gap-1', props.class)" v-bind="$attrs">
    <slot />
  </div>
</template>
