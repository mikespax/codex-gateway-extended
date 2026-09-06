<script setup lang="ts">
import { CommandEmpty } from "@codex-gateway/ui/command";

type VoiceSelectorEmptyProps = InstanceType<typeof CommandEmpty>["$props"];

interface Props extends /* @vue-ignore */ VoiceSelectorEmptyProps {}

defineProps<Props>();
</script>

<template>
  <CommandEmpty>
    <slot />
  </CommandEmpty>
</template>
