<script setup lang="ts">
import { CardContent } from "@codex-gateway/ui/card";
import { CollapsibleContent } from "@codex-gateway/ui/collapsible";
</script>

<template>
  <CollapsibleContent as-child>
    <CardContent data-slot="plan-content">
      <slot />
    </CardContent>
  </CollapsibleContent>
</template>
