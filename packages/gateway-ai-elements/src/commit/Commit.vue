<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Collapsible } from "@codex-gateway/ui/collapsible";
import { cn } from "@codex-gateway/ui/utils";

type CommitProps = InstanceType<typeof Collapsible>["$props"];

interface Props extends /* @vue-ignore */ CommitProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <Collapsible :class="cn('rounded-lg border bg-background', props.class)" v-bind="$attrs">
    <slot />
  </Collapsible>
</template>
