<script setup lang="ts">
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  FileCodeIcon,
  GitCompareArrowsIcon,
  Loader2Icon,
  RefreshCwIcon,
  SaveIcon,
} from "@lucide/vue";
import type { FilePreviewDocument, RemoteGitFileStatus } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";

export type FileEditorMode = "source" | "preview" | "changes";

const props = defineProps<{
  document: FilePreviewDocument;
  mode: FileEditorMode;
  markdown: boolean;
  editable: boolean;
  gitVisible: boolean;
  gitLoading: boolean;
  gitError: string | null;
  gitStatus: RemoteGitFileStatus | null;
  gitUnavailableReason: "ignored" | "tooLarge" | null;
  changesAvailable: boolean;
}>();
const emit = defineEmits<{
  "update:mode": [mode: FileEditorMode];
  conflict: [];
  save: [];
  refreshGit: [];
  previousChange: [];
  nextChange: [];
}>();
const { t } = useI18n();

function gitStatusLabel(status: RemoteGitFileStatus | null) {
  if (status === null) return "";
  return t(`app.fileGitStatus.${status}`);
}

function gitChangesTitle() {
  if (props.gitUnavailableReason === "tooLarge") return t("app.fileGitDiffTooLarge");
  if (props.gitUnavailableReason === "ignored") return t("app.fileGitIgnored");
  return props.changesAvailable ? t("app.fileGitChanges") : t("app.fileGitNoChanges");
}
</script>

<template>
  <div
    data-testid="file-editor-toolbar"
    class="flex min-h-10 shrink-0 items-center gap-1 overflow-hidden border-b border-hairline bg-canvas-soft/60 px-2 sm:gap-2 sm:px-3"
  >
    <div
      v-if="markdown || gitVisible || gitLoading"
      class="flex min-w-0 items-center rounded-md border border-hairline bg-surface p-0.5"
    >
      <Button
        size="sm"
        :variant="mode === 'source' ? 'secondary' : 'ghost'"
        class="h-7 gap-1.5 px-1.5 sm:px-2"
        :title="t('app.fileSource')"
        @click="emit('update:mode', 'source')"
      >
        <FileCodeIcon class="size-3.5" />
        <span class="hidden sm:inline">{{ t("app.fileSource") }}</span>
      </Button>
      <Button
        v-if="markdown"
        size="sm"
        :variant="mode === 'preview' ? 'secondary' : 'ghost'"
        class="h-7 gap-1.5 px-1.5 sm:px-2"
        :title="t('app.fileRenderedPreview')"
        @click="emit('update:mode', 'preview')"
      >
        <EyeIcon class="size-3.5" />
        <span class="hidden sm:inline">{{ t("app.fileRenderedPreview") }}</span>
      </Button>
      <Button
        v-if="gitVisible"
        size="sm"
        :variant="mode === 'changes' ? 'secondary' : 'ghost'"
        class="h-7 gap-1.5 px-1.5 sm:px-2"
        :disabled="!changesAvailable"
        :title="gitChangesTitle()"
        @click="emit('update:mode', 'changes')"
      >
        <GitCompareArrowsIcon class="size-3.5" />
        <span class="hidden sm:inline">{{ t("app.fileGitChanges") }}</span>
      </Button>
    </div>

    <div v-if="mode === 'changes'" class="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        :title="t('app.fileGitPreviousChange')"
        @click="emit('previousChange')"
      >
        <ArrowUpIcon class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        :title="t('app.fileGitNextChange')"
        @click="emit('nextChange')"
      >
        <ArrowDownIcon class="size-3.5" />
      </Button>
    </div>

    <div v-if="gitLoading" class="flex items-center gap-1 text-xs text-ink-muted">
      <Loader2Icon class="size-3.5 animate-spin" />
      <span class="hidden sm:inline">{{ t("app.fileGitLoading") }}</span>
    </div>
    <div v-else-if="gitError" class="flex min-w-0 items-center gap-1 text-xs text-destructive">
      <span class="max-w-48 truncate" :title="gitError">{{ t("app.fileGitLoadFailed") }}</span>
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        :title="t('app.fileGitRefresh')"
        @click="emit('refreshGit')"
      >
        <RefreshCwIcon class="size-3.5" />
      </Button>
    </div>
    <div
      v-else-if="gitVisible && gitStatus"
      class="hidden items-center gap-1 text-xs text-ink-muted sm:flex"
      :title="gitStatusLabel(gitStatus)"
    >
      <span>{{ gitStatusLabel(gitStatus) }}</span>
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        :title="t('app.fileGitRefresh')"
        @click="emit('refreshGit')"
      >
        <RefreshCwIcon class="size-3.5" />
      </Button>
    </div>

    <div class="ml-auto flex min-w-0 items-center gap-1 text-xs text-ink-muted sm:gap-2">
      <span v-if="!editable" class="truncate text-accent-orange-deep">
        {{ t("app.fileTooLargeToEdit") }}
      </span>
      <span v-else-if="document.saving" class="flex items-center gap-1.5">
        <Loader2Icon class="size-3.5 animate-spin" />{{ t("app.savingFile") }}
      </span>
      <span
        v-else-if="document.saveError"
        class="max-w-64 truncate text-destructive"
        :title="document.saveError"
      >
        {{ document.saveError }}
      </span>
      <button
        v-else-if="document.conflict"
        type="button"
        class="text-destructive underline underline-offset-2"
        @click="emit('conflict')"
      >
        {{ t("app.fileConflict") }}
      </button>
      <span v-else-if="document.dirty" class="hidden sm:inline">{{ t("app.fileUnsaved") }}</span>
      <span v-else class="hidden sm:inline">{{ t("app.fileSaved") }}</span>
      <Button
        v-if="editable"
        variant="ghost"
        size="icon"
        class="size-7"
        :disabled="document.saving || !document.dirty"
        :title="t('app.saveFile')"
        @click="emit('save')"
      >
        <SaveIcon class="size-3.5" />
      </Button>
    </div>
  </div>
</template>
