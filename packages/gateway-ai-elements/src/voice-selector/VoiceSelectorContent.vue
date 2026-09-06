<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Command } from "@codex-gateway/ui/command";
import { DialogContent, DialogDescription, DialogTitle } from "@codex-gateway/ui/dialog";
import { cn } from "@codex-gateway/ui/utils";

type VoiceSelectorContentProps = InstanceType<typeof DialogContent>["$props"];

interface Props extends /* @vue-ignore */ VoiceSelectorContentProps {
  class?: HTMLAttributes["class"];
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: "Voice Selector",
});
</script>

<template>
  <DialogContent :class="cn('p-0', props.class)">
    <DialogTitle class="sr-only">
      {{ title }}
    </DialogTitle>
    <DialogDescription class="sr-only"> Select a voice from the list </DialogDescription>
    <Command class="**:data-[slot=command-input-wrapper]:h-auto">
      <slot />
    </Command>
  </DialogContent>
</template>
