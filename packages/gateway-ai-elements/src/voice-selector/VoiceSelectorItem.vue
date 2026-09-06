<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CommandItem } from "@codex-gateway/ui/command";
import { cn } from "@codex-gateway/ui/utils";

type VoiceSelectorItemProps = InstanceType<typeof CommandItem>["$props"];

interface Props extends /* @vue-ignore */ VoiceSelectorItemProps {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();

const { class: _, ...rest } = props;
</script>

<template>
  <CommandItem
    :class="cn('hover:bg-accent hover:text-accent-foreground px-4 py-2', props.class)"
    v-bind="rest"
  >
    <slot />
  </CommandItem>
</template>
