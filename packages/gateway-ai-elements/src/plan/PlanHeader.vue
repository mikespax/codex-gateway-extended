<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CardHeader } from "@codex-gateway/ui/card";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <CardHeader
    :class="cn('flex flex-row items-start justify-between', props.class)"
    data-slot="plan-header"
  >
    <slot />
  </CardHeader>
</template>
