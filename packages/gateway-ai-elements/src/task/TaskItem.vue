<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@codex-gateway/ui/utils";

interface TaskItemProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<TaskItemProps>();
</script>

<template>
  <div :class="cn('text-sm text-muted-foreground', props.class)">
    <slot />
  </div>
</template>
