<script setup lang="ts">
import type { CodexApprovalPresentation } from "./presentation";
import {
  Confirmation,
  ConfirmationActions,
  ConfirmationTitle,
} from "@codex-gateway/ai-elements/confirmation";

defineProps<{
  presentation: CodexApprovalPresentation;
}>();
</script>

<template>
  <Confirmation
    :approval="presentation.approval"
    :state="presentation.state"
    class="border-accent-orange/30 bg-accent-orange/10 text-sm text-accent-orange-deep"
  >
    <ConfirmationTitle class="flex items-center gap-2 font-medium text-accent-orange-deep">
      <slot name="title" />
    </ConfirmationTitle>
    <slot />
    <ConfirmationActions
      v-if="presentation.respondable && presentation.actions.length > 0"
      class="mt-1 flex-wrap justify-start self-start"
    >
      <slot name="actions" />
    </ConfirmationActions>
    <div v-if="presentation.phase === 'resolved'" class="text-xs text-accent-orange-deep">
      {{ $t("app.serverRequestResolved") }}
    </div>
  </Confirmation>
</template>
