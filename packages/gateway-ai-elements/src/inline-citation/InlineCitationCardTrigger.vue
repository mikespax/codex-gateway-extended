<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { HoverCardTrigger } from "@codex-gateway/ui/hover-card";
import { cn } from "@codex-gateway/ui/utils";
import { computed } from "vue";

const props = defineProps<{
  sources: string[];
  class?: HTMLAttributes["class"];
}>();

const displayText = computed(() => {
  const firstSource = props.sources[0];
  if (!firstSource) return "unknown";

  try {
    const hostname = new URL(firstSource).hostname;
    const additionalCount = props.sources.length - 1;
    return additionalCount > 0 ? `${hostname} +${additionalCount}` : hostname;
  } catch {
    return "unknown";
  }
});
</script>

<template>
  <HoverCardTrigger as-child>
    <Badge :class="cn('ml-1 rounded-full', props.class)" variant="secondary">
      {{ displayText }}
    </Badge>
  </HoverCardTrigger>
</template>
