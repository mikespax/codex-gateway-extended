<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Card } from "@codex-gateway/ui/card";
import { Collapsible } from "@codex-gateway/ui/collapsible";
import { cn } from "@codex-gateway/ui/utils";
import { computed } from "vue";
import { providePlan } from "./context";

interface PlanProps {
  isStreaming?: boolean;
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<PlanProps>(), {
  isStreaming: false,
});

providePlan({
  isStreaming: computed(() => props.isStreaming),
});
</script>

<template>
  <Collapsible as-child data-slot="plan" v-bind="props">
    <Card :class="cn('shadow-none', props.class)">
      <slot />
    </Card>
  </Collapsible>
</template>
