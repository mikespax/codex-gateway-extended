<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div :class="cn('contents', props.class)" v-bind="props">
    <slot />
  </div>
</template>
