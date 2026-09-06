<script setup lang="ts">
import { CommandEmpty } from "@codex-gateway/ui/command";
</script>

<template>
  <CommandEmpty v-bind="$attrs">
    <slot />
  </CommandEmpty>
</template>
