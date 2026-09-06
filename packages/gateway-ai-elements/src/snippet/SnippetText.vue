<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { InputGroupText } from "@codex-gateway/ui/input-group";
import { cn } from "@codex-gateway/ui/utils";

type InputGroupTextProps = InstanceType<typeof InputGroupText>["$props"];

interface Props extends /* @vue-ignore */ InputGroupTextProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <InputGroupText
    :class="cn('pl-2 font-normal text-muted-foreground', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </InputGroupText>
</template>
