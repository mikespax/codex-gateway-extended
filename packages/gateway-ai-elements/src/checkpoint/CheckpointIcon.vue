<script lang="ts" setup>
import type { HTMLAttributes } from "vue";
import { BookmarkIcon } from "@lucide/vue";
import { cn } from "@codex-gateway/ui/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <slot v-if="$slots.default" />

  <BookmarkIcon v-else :class="cn('size-4 shrink-0', props.class)" v-bind="$attrs" />
</template>
