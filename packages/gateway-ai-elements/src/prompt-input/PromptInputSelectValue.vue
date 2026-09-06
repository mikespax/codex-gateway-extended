<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { SelectValue } from "@codex-gateway/ui/select";
import { cn } from "@codex-gateway/ui/utils";

type PromptInputSelectValueProps = InstanceType<typeof SelectValue>["$props"];

interface Props extends /* @vue-ignore */ PromptInputSelectValueProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <SelectValue :class="cn(props.class)" v-bind="props">
    <slot />
  </SelectValue>
</template>
