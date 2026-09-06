<script setup lang="ts">
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Maximize2Icon,
  GitBranchIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "@lucide/vue";
import { TreeRoot } from "reka-ui";
import { computed, ref, watch } from "vue";
import { Button } from "@codex-gateway/ui/button";
import { useFileGitWorkspace } from "@/composables/files/useFileGitWorkspace";
import GitChangeTreeRow from "./GitChangeTreeRow.vue";
import GitChangeDiffViewer from "./GitChangeDiffViewer.vue";
import {
  buildGitChangeTree,
  gitChangeDirectoryPaths,
  type GitChangeFileNode,
  type GitChangeTreeNode,
} from "./git-change-tree";

const props = withDefaults(
  defineProps<{
    hostId: number;
    projectId: number | null;
    rootPath: string;
    presentation?: "sidebar" | "review";
    canPromote?: boolean;
    selectedPath?: string | null;
  }>(),
  { presentation: "sidebar", canPromote: false, selectedPath: null },
);
const emit = defineEmits<{
  open: [path: string, change: RemoteGitWorkspaceFile];
  openReview: [];
  select: [path: string];
}>();
const git = useFileGitWorkspace({
  hostId: () => props.hostId,
  projectId: () => props.projectId,
  rootPath: () => props.rootPath,
});
const selected = ref<GitChangeTreeNode>();
const expanded = ref<string[]>([]);
const tree = computed(() =>
  buildGitChangeTree(git.changes.value, git.pathForChange, props.rootPath),
);
const availableSnapshot = computed(() => {
  const snapshot = git.state.value?.snapshot;
  return snapshot?.availability === "available" ? snapshot : null;
});
const selectedFile = computed(() => (selected.value?.kind === "file" ? selected.value : null));

watch(
  [tree, () => props.selectedPath],
  ([nodes, requestedPath]) => {
    if (props.presentation !== "review") return;
    const selectedPath = selectedFile.value?.path;
    const files = flattenFiles(nodes);
    selected.value =
      files.find((node) => node.path === requestedPath) ??
      files.find((node) => node.path === selectedPath) ??
      files[0];
  },
  { immediate: true },
);
watch(
  () => git.state.value?.stale,
  (stale) => stale === true && void git.load(),
  { immediate: true },
);

function selectNode(node: GitChangeTreeNode | undefined) {
  // Reka emits an empty model value while a newly mounted tree registers its items. That is not a
  // user deselection and must not erase the path restored by the review scope store.
  if (node === undefined) return;
  selected.value = node;
  if (node.kind !== "file") return;
  if (props.presentation === "sidebar") emit("open", node.path, node.change);
  else emit("select", node.path);
}

function expandAll() {
  expanded.value = gitChangeDirectoryPaths(tree.value);
}

function fileNode(value: unknown) {
  return value as GitChangeTreeNode;
}

function flattenFiles(nodes: GitChangeTreeNode[]) {
  return nodes.flatMap((node): GitChangeFileNode[] =>
    node.kind === "file" ? [node] : flattenFiles(node.children),
  );
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 overflow-hidden"
    :class="presentation === 'review' ? 'flex-col md:flex-row' : 'flex-col'"
  >
    <section
      class="flex min-h-0 flex-col overflow-hidden bg-canvas-soft/45"
      :class="
        presentation === 'review'
          ? 'h-48 w-full shrink-0 border-b border-hairline md:h-auto md:w-80 md:border-r md:border-b-0'
          : 'flex-1'
      "
    >
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <GitBranchIcon class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
          {{ availableSnapshot?.branch ?? $t("app.fileGitChanges") }}
        </span>
        <Button
          v-if="canPromote"
          variant="ghost"
          size="icon-sm"
          :aria-label="$t('app.fileGitOpenReview')"
          @click="emit('openReview')"
        >
          <Maximize2Icon class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="$t('app.fileGitCollapseAll')"
          @click="expanded = []"
        >
          <ChevronsDownUpIcon class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="$t('app.fileGitExpandAll')"
          @click="expandAll"
        >
          <ChevronsUpDownIcon class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="$t('app.fileGitRefresh')"
          @click="git.refresh"
        >
          <RefreshCwIcon class="size-3.5" :class="git.state.value?.loading ? 'animate-spin' : ''" />
        </Button>
      </div>
      <div
        v-if="git.state.value?.error"
        class="m-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive"
      >
        {{ git.state.value.error }}
      </div>
      <div
        v-else-if="git.state.value?.loading && !git.state.value.loaded"
        class="flex flex-1 items-center justify-center text-sm text-ink-muted"
      >
        <Loader2Icon class="mr-2 size-4 animate-spin" />
        {{ $t("app.fileGitLoading") }}
      </div>
      <div
        v-else-if="git.state.value?.snapshot?.availability !== 'available'"
        class="flex flex-1 items-center justify-center px-5 text-center text-sm text-ink-muted"
      >
        {{ $t("app.fileGitWorkspaceUnavailable") }}
      </div>
      <div
        v-else-if="tree.length === 0"
        class="flex flex-1 items-center justify-center px-5 text-center text-sm text-ink-muted"
      >
        {{ $t("app.fileGitNoChanges") }}
      </div>
      <TreeRoot
        v-else
        v-model:expanded="expanded"
        :model-value="selected"
        :items="tree"
        :get-key="(node: GitChangeTreeNode) => node.path"
        :get-children="
          (node: GitChangeTreeNode) => (node.kind === 'directory' ? node.children : undefined)
        "
        class="min-h-0 flex-1 list-none overflow-auto py-2 outline-none"
        data-testid="git-changes-tree"
        @update:model-value="selectNode"
      >
        <template #default="{ flattenItems }">
          <GitChangeTreeRow
            v-for="item in flattenItems"
            :key="item._id"
            :node="fileNode(item.value)"
            :level="item.level"
          />
        </template>
      </TreeRoot>
    </section>
    <GitChangeDiffViewer
      v-if="presentation === 'review' && selectedFile && projectId !== null"
      :host-id="hostId"
      :project-id="projectId"
      :path="selectedFile.path"
      :change="selectedFile.change"
    />
    <div
      v-else-if="presentation === 'review'"
      class="flex min-w-0 flex-1 items-center justify-center text-sm text-ink-muted"
    >
      {{ $t("app.fileGitSelectChange") }}
    </div>
  </div>
</template>
