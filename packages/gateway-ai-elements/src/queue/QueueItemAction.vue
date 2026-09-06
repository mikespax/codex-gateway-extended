<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Button } from "@codex-gateway/ui/button";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <Button
    :class="
      cn(
        'size-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground group-hover:opacity-100',
        props.class,
      )
    "
    size="icon"
    type="button"
    variant="ghost"
  >
    <slot />
  </Button>
</template>
