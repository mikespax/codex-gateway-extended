<script setup lang="ts">
import { computed } from "vue";
import { ConfirmationAction } from "@codex-gateway/ai-elements/confirmation";
import CodexApprovalConfirmation from "@/components/thread/items/approval/CodexApprovalConfirmation.vue";
import { useServerRequestResponder } from "@/composables/thread/useServerRequestResponder";
import { projectCodexApproval } from "@/components/thread/items/approval/presentation";

const props = defineProps<{
  pendingApproval: {
    requestId?: string | number | null;
    params?: { reason?: unknown } | null;
  };
  hostId: number | null;
  threadId: string | null;
  presentationId: string;
}>();

const { t } = useI18n();
const requestId = computed(() => props.pendingApproval?.requestId);
const {
  canRespond,
  responding,
  respond: respondToRequest,
} = useServerRequestResponder({
  hostId: computed(() => props.hostId),
  threadId: computed(() => props.threadId),
  requestId,
});
const approvalPresentation = computed(() =>
  projectCodexApproval({
    kind: "fileChange",
    requestId: requestId.value,
    pending: true,
    canRespond: canRespond.value,
    presentationId: props.presentationId,
  }),
);

async function respond(result: unknown) {
  await respondToRequest(result);
}
</script>

<template>
  <CodexApprovalConfirmation class="mt-3" :presentation="approvalPresentation">
    <template #title>{{ t("app.fileApprovalRequired") }}</template>
    <div v-if="pendingApproval.params?.reason" class="mt-1 text-accent-orange-deep">
      {{ pendingApproval.params.reason }}
    </div>
    <template #actions>
      <ConfirmationAction
        v-for="action in approvalPresentation.actions"
        :key="action.id"
        size="sm"
        :variant="action.variant"
        :disabled="responding"
        :data-testid="action.testId"
        @click="respond(action.result)"
      >
        {{ t(action.label) }}
      </ConfirmationAction>
    </template>
  </CodexApprovalConfirmation>
</template>
