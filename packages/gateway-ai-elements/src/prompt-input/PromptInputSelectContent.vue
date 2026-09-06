<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { SelectContent } from "@codex-gateway/ui/select";
import { cn } from "@codex-gateway/ui/utils";

type SelectContentProps = InstanceType<typeof SelectContent>["$props"];

interface Props extends /* @vue-ignore */ SelectContentProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <SelectContent :class="cn(props.class)" v-bind="props">
    <slot />
  </SelectContent>
</template>
