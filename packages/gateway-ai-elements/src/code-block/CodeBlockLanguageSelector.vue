<script setup lang="ts">
import { Select } from "@codex-gateway/ui/select";

type CodeBlockLanguageSelectorProps = InstanceType<typeof Select>["$props"];

interface Props extends /* @vue-ignore */ CodeBlockLanguageSelectorProps {}

const props = defineProps<Props>();
</script>

<template>
  <Select v-bind="{ ...props, ...$attrs }">
    <slot />
  </Select>
</template>
