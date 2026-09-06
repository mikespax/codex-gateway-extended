<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CardContent } from "@codex-gateway/ui/card";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <CardContent :class="cn('p-3', props.class)">
    <slot />
  </CardContent>
</template>
