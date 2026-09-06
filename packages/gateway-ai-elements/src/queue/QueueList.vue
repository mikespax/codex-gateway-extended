<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { ScrollArea } from "@codex-gateway/ui/scroll-area";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <ScrollArea :class="cn('-mb-1 mt-2', props.class)" v-bind="$attrs">
    <div class="max-h-40 pr-4">
      <ul>
        <slot />
      </ul>
    </div>
  </ScrollArea>
</template>
