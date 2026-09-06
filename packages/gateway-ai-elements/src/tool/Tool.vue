<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Collapsible } from "@codex-gateway/ui/collapsible";
import { cn } from "@codex-gateway/ui/utils";

type ToolProps = InstanceType<typeof Collapsible>["$props"];

interface Props extends /* @vue-ignore */ ToolProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <Collapsible
    :class="cn('group not-prose mb-4 w-full rounded-md border', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </Collapsible>
</template>
