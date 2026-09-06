<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CollapsibleContent } from "@codex-gateway/ui/collapsible";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <CollapsibleContent :class="cn(props.class)">
    <slot />
  </CollapsibleContent>
</template>
