<script setup lang="ts">
import { goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import type { StateCommand } from "@codemirror/state";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { RemoteGitWorkspaceFile } from "~~/shared/types";
import { MAX_GIT_DIFF_BYTES } from "~~/shared/file-preview";
import { Button } from "@codex-gateway/ui/button";
import CodeEditor from "@/components/common/CodeEditor.vue";
import { useFileGitComparisonStore } from "@/stores/file-workspace/git";
import { fetchRemoteFile } from "@/utils/remote-file-transport";
import { codeEditorLanguageForPath } from "@/utils/code-editor-extensions";
import { gitUnifiedDiffExtension } from "@/utils/code-editor-git-diff";
import { gitStatusCode, gitStatusTextClass } from "@/utils/git-status-presentation";

const props = defineProps<{
  hostId: number;
  projectId: number;
  path: string;
  change: RemoteGitWorkspaceFile;
}>();
const comparisonStore = useFileGitComparisonStore();
const { t } = useI18n();
const currentText = ref("");
const loadingContent = ref(false);
const contentError = ref<string | null>(null);
const editorRef = ref<{ runCommand: (command: StateCommand) => boolean } | null>(null);
let controller: AbortController | null = null;
const target = computed(() => ({
  hostId: props.hostId,
  projectId: props.projectId,
  path: props.path,
}));
const state = computed(() => comparisonStore.stateForTarget(target.value));
const baseline = computed(() => state.value.baselineText);
const extensions = computed(() =>
  baseline.value === null ? [] : [gitUnifiedDiffExtension(baseline.value)],
);
const loading = computed(() => state.value.loading || loadingContent.value);
const error = computed(() => state.value.error ?? contentError.value);

watch(
  () => [props.hostId, props.projectId, props.path, props.change] as const,
  () => void load(true),
  { immediate: true },
);
onBeforeUnmount(() => controller?.abort());

async function load(force = false) {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loadingContent.value = true;
  contentError.value = null;
  try {
    const comparison = await comparisonStore.loadTarget(target.value, force);
    if (signal.aborted || comparison.error !== null) return;
    if (props.change.status === "deleted") {
      currentText.value = "";
      return;
    }
    const response = await fetchRemoteFile(props.hostId, props.path, null, signal);
    if (signal.aborted || response.changed === false) return;
    if (response.previewKind !== "text" || response.blob.size > MAX_GIT_DIFF_BYTES) {
      contentError.value = t("app.fileGitDiffTooLarge");
      return;
    }
    currentText.value = await response.blob.text();
  } catch (loadError: unknown) {
    if (!signal.aborted) {
      contentError.value = loadError instanceof Error ? loadError.message : String(loadError);
    }
  } finally {
    if (!signal.aborted) loadingContent.value = false;
  }
}

function run(command: StateCommand) {
  editorRef.value?.runCommand(command);
}
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
      <span class="min-w-0 flex-1 truncate text-sm font-medium" :title="path">{{ path }}</span>
      <span class="text-xs font-semibold" :class="gitStatusTextClass(change.status)">
        {{ gitStatusCode(change.status) }}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="$t('app.fileGitPreviousChange')"
        @click="run(goToPreviousChunk)"
      >
        <ArrowUpIcon class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="$t('app.fileGitNextChange')"
        @click="run(goToNextChunk)"
      >
        <ArrowDownIcon class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="$t('app.fileGitRefresh')"
        @click="load(true)"
      >
        <RefreshCwIcon class="size-3.5" :class="loading ? 'animate-spin' : ''" />
      </Button>
    </div>
    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-ink-muted">
      <Loader2Icon class="mr-2 size-4 animate-spin" />
      {{ $t("app.fileGitLoading") }}
    </div>
    <div
      v-else-if="error"
      class="m-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircleIcon class="mt-0.5 size-4 shrink-0" />
      <span class="break-words">{{ error }}</span>
    </div>
    <CodeEditor
      v-else-if="baseline !== null"
      :key="path"
      ref="editorRef"
      v-model="currentText"
      test-id="git-review-diff-editor"
      class="rounded-none border-0"
      :language="codeEditorLanguageForPath(path)"
      :extensions="extensions"
      :read-only="true"
      :line-wrapping="false"
    />
    <div v-else class="flex flex-1 items-center justify-center text-sm text-ink-muted">
      {{ $t("app.fileGitDiffTooLarge") }}
    </div>
  </section>
</template>
