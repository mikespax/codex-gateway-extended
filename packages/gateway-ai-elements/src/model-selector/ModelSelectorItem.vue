<script setup lang="ts">
import { CommandItem } from "@codex-gateway/ui/command";

const props = defineProps<{
  value: string;
}>();
</script>

<template>
  <CommandItem v-bind="$attrs" :value="props.value">
    <slot />
  </CommandItem>
</template>
