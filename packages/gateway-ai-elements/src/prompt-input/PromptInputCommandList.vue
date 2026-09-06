<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CommandList } from "@codex-gateway/ui/command";
import { cn } from "@codex-gateway/ui/utils";

type PromptInputCommandListProps = InstanceType<typeof CommandList>["$props"];

interface Props extends /* @vue-ignore */ PromptInputCommandListProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <CommandList :class="cn(props.class)" v-bind="props" />
</template>
