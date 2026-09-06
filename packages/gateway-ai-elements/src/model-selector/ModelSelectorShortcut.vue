<script setup lang="ts">
import { CommandShortcut } from "@codex-gateway/ui/command";
</script>

<template>
  <CommandShortcut v-bind="$attrs">
    <slot />
  </CommandShortcut>
</template>
