<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import type { StateCommand } from "@codemirror/state";
import { goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import type { FilePreviewDocument } from "~~/shared/types";
import { isMarkdownPreviewPath, MAX_EDITABLE_FILE_BYTES } from "~~/shared/file-preview";
import CodeEditor from "@/components/common/CodeEditor.vue";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { codeEditorLanguageForPath } from "@/utils/code-editor-extensions";
import { fileEditorExtensions } from "@/utils/file-editor-extensions";
import { gitQuickDiffExtension, gitUnifiedDiffExtension } from "@/utils/code-editor-git-diff";
import { useFileGitComparison } from "@/composables/files/useFileGitComparison";
import FileMarkdownPreview from "./FileMarkdownPreview.vue";
import FileEditorToolbar, { type FileEditorMode } from "./FileEditorToolbar.vue";

const props = defineProps<{ document: FilePreviewDocument }>();
const emit = defineEmits<{ conflict: [] }>();
const fileWorkspace = useGatewayFileWorkspaceStore();
const editable = computed(() => (props.document.size ?? 0) <= MAX_EDITABLE_FILE_BYTES);
const markdown = computed(() =>
  isMarkdownPreviewPath(props.document.path, props.document.contentType),
);
const mode = ref<FileEditorMode>(defaultMode(props.document));
const language = computed(() => codeEditorLanguageForPath(props.document.path));
const editorRef = ref<{ runCommand: (command: StateCommand) => boolean } | null>(null);
const git = useFileGitComparison(toRef(props, "document"));
const gitState = git.state;
const gitHasChanges = git.hasChanges;
const gitVisible = computed(() => git.available.value);
const gitStatus = git.status;
const editorExtensions = computed(() => {
  const baseline = git.baselineText.value;
  if (baseline === null) return fileEditorExtensions;
  return [
    ...fileEditorExtensions,
    ...(mode.value === "changes"
      ? [gitUnifiedDiffExtension(baseline)]
      : [gitQuickDiffExtension(baseline)]),
  ];
});
const draft = computed({
  get: () => props.document.draftText,
  set: (value) => fileWorkspace.updateDocumentDraft(props.document, value),
});
const editorValue = computed({
  get: () => (mode.value === "changes" ? git.currentText.value : draft.value),
  set: (value) => {
    draft.value = value;
  },
});

// Dockview keeps this editor mounted while file tabs change. Reset only when the
// displayed document changes so Markdown opens rendered, while a user's explicit
// source/preview choice remains stable for the current document.
watch([() => props.document.path, () => props.document.contentType], () => {
  mode.value = defaultMode(props.document);
});

watch(
  () => props.document.requestedView,
  (requestedView) => {
    if (requestedView === null) return;
    mode.value = requestedView;
    fileWorkspace.consumeDocumentViewRequest(props.document);
  },
  { immediate: true },
);

watch(git.hasChanges, (hasChanges) => {
  if (!hasChanges && mode.value === "changes") mode.value = "source";
});

function defaultMode(document: FilePreviewDocument): FileEditorMode {
  return isMarkdownPreviewPath(document.path, document.contentType) ? "preview" : "source";
}

function save() {
  if (editable.value) void fileWorkspace.saveDocument(props.document);
}

function runDiffCommand(command: StateCommand) {
  editorRef.value?.runCommand(command);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
    <FileEditorToolbar
      :document="document"
      :mode="mode"
      :markdown="markdown"
      :editable="editable"
      :git-visible="gitVisible"
      :git-loading="gitState.loading"
      :git-error="gitState.error"
      :git-status="gitStatus"
      :git-unavailable-reason="git.unavailableReason.value"
      :changes-available="gitHasChanges"
      @update:mode="mode = $event"
      @conflict="emit('conflict')"
      @save="save"
      @refresh-git="git.refresh()"
      @previous-change="runDiffCommand(goToPreviousChunk)"
      @next-change="runDiffCommand(goToNextChunk)"
    />
    <FileMarkdownPreview v-if="markdown && mode === 'preview'" :document="document" />
    <CodeEditor
      v-else
      :key="mode"
      ref="editorRef"
      v-model="editorValue"
      :test-id="mode === 'changes' ? 'remote-file-diff-editor' : 'remote-file-editor'"
      class="rounded-none border-0"
      :language="language"
      :extensions="editorExtensions"
      :read-only="!editable"
      :line-wrapping="false"
      :reveal-line="document.line"
      :initial-scroll-position="
        fileWorkspace.viewPositionFor(document.key, mode === 'changes' ? 'changes' : 'source')
      "
      @blur="save"
      @save="save"
      @scroll-position="
        fileWorkspace.rememberViewPosition(
          document.key,
          mode === 'changes' ? 'changes' : 'source',
          $event,
        )
      "
    />
  </div>
</template>
