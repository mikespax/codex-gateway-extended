<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import ComposerShell from "@/components/chat/composer/ComposerShell.vue";
import { useComposerController } from "@/composables/composer/useComposerController";

const {
  activeEffortCompactLabel,
  activeEffortValue,
  activeServiceTier,
  activeServiceTierLabel,
  activeModel,
  activeModelLabel,
  activePlanSummary,
  attachedFiles,
  fileReferences,
  canInterruptTurn,
  canStopTurn,
  canUsePrimaryAction,
  composerInputEnabled,
  deactivatePlanMode,
  effortOptions,
  filteredSlashCommands,
  goalActionPending,
  goalInputActive,
  handleAttachmentChange,
  handleComposerKeydown,
  handleDrop,
  handlePaste,
  handlePrimaryAction,
  interruptTurn,
  hasComposerInput,
  interruptingTurn,
  isThreadRunning,
  labelEffortOption,
  loadingModels,
  modelOptionValue,
  models,
  planModeActive,
  removeAttachment,
  runSlashCommand,
  selectSlashCommandIndex,
  selectedSlashCommandIndex,
  selectedThreadGoal,
  selectedThreadGoalObservedAt,
  selectedThreadId,
  selectedProjectId,
  selectedThreadStatus,
  selectedThreadTokenUsage,
  serviceTierOptions,
  sendButtonLabel,
  saveSelectedThreadGoal,
  stopSelectedThreadGoal,
  resumeSelectedThreadGoal,
  clearSelectedThreadGoal,
  applySelectedModelEffort,
  slashMenuOpen,
  turnText,
  uploadingAttachments,
  handleFileReferenceLimit,
} = useComposerController();

const composerShell = ref<InstanceType<typeof ComposerShell> | null>(null);

function focusDesktopComposer() {
  if (!window.matchMedia("(min-width: 48rem)").matches) return;
  void nextTick(() => {
    window.requestAnimationFrame(() => composerShell.value?.focusEditor());
  });
}

watch(selectedThreadId, (threadId, previousThreadId) => {
  if (threadId === null || threadId === previousThreadId) return;
  focusDesktopComposer();
});

onMounted(focusDesktopComposer);
</script>

<template>
  <ComposerShell
    ref="composerShell"
    v-model="turnText"
    v-model:file-references="fileReferences"
    :attached-files="attachedFiles"
    :plan-mode-active="planModeActive"
    :plan-summary="activePlanSummary"
    :goal-input-active="goalInputActive"
    :goal="selectedThreadGoal"
    :goal-observed-at="selectedThreadGoalObservedAt"
    :goal-action-pending="goalActionPending"
    :slash-menu-open="slashMenuOpen"
    :filtered-slash-commands="filteredSlashCommands"
    :selected-slash-command-index="selectedSlashCommandIndex"
    :composer-input-enabled="composerInputEnabled"
    :uploading-attachments="uploadingAttachments"
    :selected-thread-id="selectedThreadId"
    :selected-project-id="selectedProjectId"
    :selected-thread-token-usage="selectedThreadTokenUsage"
    :models="models"
    :loading-models="loadingModels"
    :active-model="activeModel"
    :active-model-label="activeModelLabel"
    :active-effort-value="activeEffortValue"
    :active-effort-compact-label="activeEffortCompactLabel"
    :active-service-tier="activeServiceTier"
    :active-service-tier-label="activeServiceTierLabel"
    :effort-options="effortOptions"
    :service-tier-options="serviceTierOptions"
    :label-effort-option="labelEffortOption"
    :model-option-value="modelOptionValue"
    :has-composer-input="hasComposerInput"
    :is-thread-running="isThreadRunning"
    :can-interrupt-turn="canInterruptTurn"
    :can-stop-turn="canStopTurn"
    :can-use-primary-action="canUsePrimaryAction"
    :interrupting-turn="interruptingTurn"
    :selected-thread-status="selectedThreadStatus"
    :send-button-label="sendButtonLabel"
    @deactivate-plan="deactivatePlanMode"
    @save-goal="saveSelectedThreadGoal"
    @stop-goal="stopSelectedThreadGoal"
    @resume-goal="resumeSelectedThreadGoal"
    @clear-goal="clearSelectedThreadGoal"
    @hover-slash-command="selectSlashCommandIndex"
    @select-slash-command="runSlashCommand"
    @attachment-change="handleAttachmentChange"
    @drop="handleDrop"
    @paste="handlePaste"
    @remove-attachment="removeAttachment"
    @keydown="handleComposerKeydown"
    @file-reference-limit="handleFileReferenceLimit"
    @primary-action="handlePrimaryAction"
    @interrupt-turn="interruptTurn"
    @apply-model-effort="applySelectedModelEffort"
  />
</template>
