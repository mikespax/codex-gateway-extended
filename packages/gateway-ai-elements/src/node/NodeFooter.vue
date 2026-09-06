<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CardFooter } from "@codex-gateway/ui/card";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <CardFooter :class="cn('rounded-b-md border-t bg-secondary p-3!', props.class)">
    <slot />
  </CardFooter>
</template>
