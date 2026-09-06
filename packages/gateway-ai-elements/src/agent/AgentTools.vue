<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Accordion } from "@codex-gateway/ui/accordion";
import { cn } from "@codex-gateway/ui/utils";

type AgentToolsProps = InstanceType<typeof Accordion>["$props"];

interface Props extends /* @vue-ignore */ AgentToolsProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <div :class="cn('space-y-2', props.class)">
    <span class="font-medium text-muted-foreground text-sm">Tools</span>
    <Accordion class="rounded-md border" type="multiple" v-bind="$attrs">
      <slot />
    </Accordion>
  </div>
</template>
