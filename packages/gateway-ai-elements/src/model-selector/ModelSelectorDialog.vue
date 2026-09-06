<script setup lang="ts">
import { CommandDialog } from "@codex-gateway/ui/command";
</script>

<template>
  <CommandDialog v-bind="$attrs">
    <slot />
  </CommandDialog>
</template>
