<script setup lang="ts">
import ColorHash from "color-hash";
import { computed } from "vue";
import { Badge } from "@codex-gateway/ui/badge";

const props = withDefaults(
  defineProps<{
    seed: string;
    label: string;
    active?: boolean;
  }>(),
  { active: false },
);

const colorHash = new ColorHash();
const color = computed(() => colorHash.hex(props.seed));
const badgeStyle = computed(() => ({
  borderColor: `color-mix(in srgb, ${color.value} 45%, transparent)`,
  backgroundColor: `color-mix(in srgb, ${color.value} 14%, transparent)`,
  color: `color-mix(in srgb, ${color.value} 72%, currentColor)`,
}));
</script>

<template>
  <Badge
    variant="outline"
    class="max-w-full gap-1.5"
    :class="active ? 'ring-1 ring-primary/30' : ''"
    :style="badgeStyle"
  >
    <span class="size-1.5 shrink-0 rounded-full bg-current" />
    <span class="truncate" :title="label">{{ label }}</span>
  </Badge>
</template>
