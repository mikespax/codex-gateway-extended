<script setup lang="ts">
import { CommandList } from "@codex-gateway/ui/command";
</script>

<template>
  <CommandList v-bind="$attrs">
    <slot />
  </CommandList>
</template>
