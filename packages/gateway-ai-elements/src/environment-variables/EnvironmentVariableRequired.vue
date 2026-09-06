<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { cn } from "@codex-gateway/ui/utils";

type BadgeProps = InstanceType<typeof Badge>["$props"];

interface Props extends /* @vue-ignore */ BadgeProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <Badge :class="cn('text-xs', props.class)" variant="secondary" v-bind="$attrs">
    <slot>Required</slot>
  </Badge>
</template>
