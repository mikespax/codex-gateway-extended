<script setup lang="ts">
import { Dialog } from "@codex-gateway/ui/dialog";
</script>

<template>
  <Dialog v-bind="$attrs">
    <slot />
  </Dialog>
</template>
