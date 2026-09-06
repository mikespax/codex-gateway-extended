<script setup lang="ts">
import { DialogTrigger } from "@codex-gateway/ui/dialog";
</script>

<template>
  <DialogTrigger v-bind="$attrs">
    <slot />
  </DialogTrigger>
</template>
