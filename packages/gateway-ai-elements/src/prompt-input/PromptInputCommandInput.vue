<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CommandInput } from "@codex-gateway/ui/command";
import { cn } from "@codex-gateway/ui/utils";

type PromptInputCommandInputProps = InstanceType<typeof CommandInput>["$props"];

interface Props extends /* @vue-ignore */ PromptInputCommandInputProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <CommandInput :class="cn(props.class)" v-bind="props" />
</template>
