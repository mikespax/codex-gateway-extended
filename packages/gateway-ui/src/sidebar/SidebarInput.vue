<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../utils";
import { Input } from "../input";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <Input
    data-slot="sidebar-input"
    data-sidebar="input"
    :class="cn('h-8 w-full border-input bg-surface/80', props.class)"
  >
    <slot />
  </Input>
</template>
