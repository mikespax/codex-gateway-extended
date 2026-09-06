<script setup lang="ts">
import { CommandGroup } from "@codex-gateway/ui/command";
</script>

<template>
  <CommandGroup v-bind="$attrs">
    <slot />
  </CommandGroup>
</template>
