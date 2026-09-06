<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type {
  ModelRecord,
  ReasoningEffort,
  ThreadGoal,
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
} from "~~/shared/types";
import type { ComposerAttachment } from "@/composables/composer/useComposerDraft";
import type { ComposerFileReference } from "@/stores/gateway/types";
import type { ComposerGoalPendingAction } from "@/composables/composer/useComposerGoalControls";
import type { SlashMenuItem } from "@/composables/composer/useSlashCommands";
import AttachmentChips from "@/components/chat/composer/AttachmentChips.vue";
import ComposerModeStrip from "@/components/chat/composer/ComposerModeStrip.vue";
import ComposerToolbar from "@/components/chat/composer/ComposerToolbar.vue";
import SlashCommandMenu from "@/components/chat/composer/SlashCommandMenu.vue";
import ComposerEditor from "@/components/chat/composer/ComposerEditor.vue";

const props = defineProps<{
  modelValue: string;
  fileReferences: ComposerFileReference[];
  attachedFiles: ComposerAttachment[];
  planModeActive: boolean;
  planSummary: string;
  goalInputActive: boolean;
  goal: ThreadGoal | null;
  goalObservedAt: number | null;
  goalActionPending: ComposerGoalPendingAction | null;
  slashMenuOpen: boolean;
  filteredSlashCommands: SlashMenuItem[];
  selectedSlashCommandIndex: number;
  composerInputEnabled: boolean;
  uploadingAttachments: boolean;
  selectedThreadId: string | null;
  selectedProjectId: number | null;
  selectedThreadTokenUsage: ThreadTokenUsageState | null;
  models: ModelRecord[];
  loadingModels: boolean;
  activeModel: string;
  activeModelLabel: string;
  activeEffortValue: string;
  activeEffortCompactLabel: string;
  activeServiceTier: string;
  activeServiceTierLabel: string;
  effortOptions: Array<{ value: ReasoningEffort; label?: string }>;
  serviceTierOptions: Array<{ value: string; label: string; description?: string | null }>;
  labelEffortOption: (option: { value: ReasoningEffort; label?: string }) => string;
  modelOptionValue: (modelOption: { model?: string; id: string }) => string;
  hasComposerInput: boolean;
  isThreadRunning: boolean;
  canInterruptTurn: boolean;
  canStopTurn: boolean;
  canUsePrimaryAction: boolean;
  interruptingTurn: boolean;
  selectedThreadStatus: ThreadRuntimeStatus;
  sendButtonLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:fileReferences": [value: ComposerFileReference[]];
  deactivatePlan: [];
  saveGoal: [objective: string];
  stopGoal: [];
  resumeGoal: [];
  clearGoal: [];
  hoverSlashCommand: [index: number];
  selectSlashCommand: [command: SlashMenuItem];
  attachmentChange: [event: Event];
  drop: [event: DragEvent];
  paste: [event: ClipboardEvent];
  removeAttachment: [id: string];
  keydown: [event: KeyboardEvent];
  fileReferenceLimit: [message: string];
  primaryAction: [];
  interruptTurn: [];
  applyModelEffort: [selection: { model: string; effort: ReasoningEffort; serviceTier: string }];
}>();

const composerEditor = ref<InstanceType<typeof ComposerEditor> | null>(null);
const documentUploadInput = ref<HTMLInputElement | null>(null);
const mediaUploadInput = ref<HTMLInputElement | null>(null);
const isDraggingFiles = ref(false);
const keyboardInset = ref(0);
let restingVisualViewportHeight = 0;
let visualViewport: VisualViewport | null = null;

function syncKeyboardInset() {
  const viewport = visualViewport;
  if (!viewport) return;

  const viewportHeight = viewport.height;
  const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
  const coveredHeight = Math.max(0, layoutHeight - viewportHeight - viewport.offsetTop);
  const heightDelta = Math.max(0, restingVisualViewportHeight - viewportHeight);
  const keyboardVisible = Math.max(coveredHeight, heightDelta) > 80;

  if (!keyboardVisible) {
    restingVisualViewportHeight = viewportHeight;
    keyboardInset.value = 0;
    return;
  }

  // resizes-content browsers already move the app above the keyboard, so retain a comfortable
  // 1rem gap. Overlaying browsers additionally need their covered visual-viewport height.
  keyboardInset.value = Math.max(16, Math.round(coveredHeight) + 16);
}

onMounted(() => {
  visualViewport = window.visualViewport;
  if (!visualViewport) return;
  restingVisualViewportHeight = visualViewport.height;
  visualViewport.addEventListener("resize", syncKeyboardInset);
  visualViewport.addEventListener("scroll", syncKeyboardInset);
});

onBeforeUnmount(() => {
  visualViewport?.removeEventListener("resize", syncKeyboardInset);
  visualViewport?.removeEventListener("scroll", syncKeyboardInset);
  visualViewport = null;
});

function openAttachmentPicker(kind: "documents" | "media") {
  if (kind === "documents") documentUploadInput.value?.click();
  else mediaUploadInput.value?.click();
}

function focusEditor() {
  composerEditor.value?.focus();
}

defineExpose({ focusEditor });

function dragContainsFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function handleDragEnter(event: DragEvent) {
  if (!dragContainsFiles(event)) return;
  event.preventDefault();
  isDraggingFiles.value = true;
}

function handleDragOver(event: DragEvent) {
  if (!dragContainsFiles(event)) return;
  event.preventDefault();
  isDraggingFiles.value = true;
}

function handleDragLeave(event: DragEvent) {
  if (!dragContainsFiles(event)) return;
  const composer = event.currentTarget;
  const nextTarget = event.relatedTarget;
  if (
    composer instanceof HTMLElement &&
    nextTarget instanceof Node &&
    composer.contains(nextTarget)
  ) {
    return;
  }
  isDraggingFiles.value = false;
}

function resetDragState() {
  isDraggingFiles.value = false;
}

function handleDrop(event: DragEvent) {
  isDraggingFiles.value = false;
  if (!dragContainsFiles(event)) return;
  event.preventDefault();
  emit("drop", event);
}

function composerScopeKey() {
  return `${props.selectedProjectId ?? "none"}:${props.selectedThreadId ?? "new"}`;
}

function updateModelValue(value: string, sourceScopeKey: string) {
  if (sourceScopeKey === composerScopeKey()) emit("update:modelValue", value);
}

function updateFileReferences(value: ComposerFileReference[], sourceScopeKey: string) {
  if (sourceScopeKey === composerScopeKey()) emit("update:fileReferences", value);
}
</script>

<template>
  <div
    data-testid="composer-shell"
    class="shrink-0 bg-gradient-to-t from-surface via-surface to-surface/75 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] transition-[padding,margin] focus-within:pb-[calc(env(safe-area-inset-bottom)+1.25rem)] md:px-[clamp(1rem,3vw,2rem)] md:pb-[clamp(0.5rem,1.4vh,1rem)] md:focus-within:pb-[clamp(0.5rem,1.4vh,1rem)]"
    :style="{ marginBottom: keyboardInset > 0 ? `${keyboardInset}px` : undefined }"
    :data-keyboard-inset="keyboardInset"
    @focusin="syncKeyboardInset"
  >
    <div class="mx-auto w-full max-w-3xl">
      <ComposerModeStrip
        :plan-mode-active="planModeActive"
        :plan-summary="planSummary"
        :goal-input-active="goalInputActive"
        :goal="goal"
        :goal-observed-at="goalObservedAt"
        :goal-action-pending="goalActionPending"
        @deactivate-plan="emit('deactivatePlan')"
        @save-goal="emit('saveGoal', $event)"
        @stop-goal="emit('stopGoal')"
        @resume-goal="emit('resumeGoal')"
        @clear-goal="emit('clearGoal')"
      />
      <div
        data-testid="composer-surface"
        class="relative rounded-[1.35rem] border border-hairline bg-surface p-2 shadow-lg shadow-ink/10 transition-colors md:rounded-3xl md:p-[clamp(0.45rem,1vw,0.7rem)]"
        :class="{
          'border-primary bg-primary/5 shadow-[0_0_0_2px_color-mix(in_srgb,var(--primary)_25%,transparent)]':
            isDraggingFiles,
        }"
        @dragenter="handleDragEnter"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @dragend="resetDragState"
        @drop="handleDrop"
      >
        <SlashCommandMenu
          :open="slashMenuOpen"
          :commands="filteredSlashCommands"
          :selected-index="selectedSlashCommandIndex"
          @hover="emit('hoverSlashCommand', $event)"
          @select="emit('selectSlashCommand', $event)"
        />
        <input
          ref="documentUploadInput"
          data-testid="attachment-input"
          class="hidden"
          type="file"
          multiple
          accept="application/*,text/*,.zip,.7z,.rar,.tar,.gz,.bz2,.xz,.md,.yaml,.yml,.toml,.env,.log,.patch,.diff"
          @change="emit('attachmentChange', $event)"
        />
        <input
          ref="mediaUploadInput"
          data-testid="media-attachment-input"
          class="hidden"
          type="file"
          multiple
          accept="image/*,video/*"
          @change="emit('attachmentChange', $event)"
        />
        <AttachmentChips :files="attachedFiles" @remove="emit('removeAttachment', $event)" />
        <div
          v-if="isDraggingFiles"
          class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[1rem] border border-dashed border-primary bg-surface/90 text-sm font-medium text-primary"
        >
          Drop screenshot or file to attach
        </div>
        <ComposerEditor
          ref="composerEditor"
          :key="composerScopeKey()"
          :model-value="modelValue"
          :references="fileReferences"
          :scope-key="composerScopeKey()"
          :project-id="selectedProjectId"
          :disabled="!composerInputEnabled"
          :placeholder="$t('app.askFollowUp')"
          :limit-message="$t('app.fileReferenceLimit', { count: 10 })"
          @update:model-value="updateModelValue"
          @update:references="updateFileReferences"
          @keydown="emit('keydown', $event)"
          @paste="emit('paste', $event)"
          @limit="emit('fileReferenceLimit', $event)"
        />
        <ComposerToolbar
          :uploading-attachments="uploadingAttachments"
          :selected-thread-id="selectedThreadId"
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
          @attach="openAttachmentPicker"
          @primary-action="emit('primaryAction')"
          @interrupt-turn="emit('interruptTurn')"
          @apply-model-effort="emit('applyModelEffort', $event)"
        />
      </div>
    </div>
  </div>
</template>
