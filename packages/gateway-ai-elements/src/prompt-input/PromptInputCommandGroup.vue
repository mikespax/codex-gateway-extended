<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CommandGroup } from "@codex-gateway/ui/command";
import { cn } from "@codex-gateway/ui/utils";

type PromptInputCommandGroupProps = InstanceType<typeof CommandGroup>["$props"];

interface Props extends /* @vue-ignore */ PromptInputCommandGroupProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <CommandGroup :class="cn(props.class)" v-bind="props">
    <slot />
  </CommandGroup>
</template>
