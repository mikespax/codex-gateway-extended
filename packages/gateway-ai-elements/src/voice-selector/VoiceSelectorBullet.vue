<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@codex-gateway/ui/utils";

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <span aria-hidden="true" :class="cn('select-none text-border', props.class)"> &bull; </span>
</template>
