<script setup lang="ts">
import { computed, ref } from "vue";
import { FilesIcon, GitCompareArrowsIcon } from "@lucide/vue";
import type { RemoteGitWorkspaceFile } from "~~/shared/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@codex-gateway/ui/tabs";
import { useFileGitWorkspace } from "@/composables/files/useFileGitWorkspace";
import { useFileGitReviewPanelStore } from "@/stores/file-workspace/git/review-panel";
import {
  useGatewayWorkspaceLayoutStore,
  workspaceLayoutScopeKey,
} from "@/stores/gateway-workspace-layout";
import { GIT_REVIEW_WORKSPACE_PANEL_ID } from "@/stores/gateway/workspace-panels";
import RemoteFileTree from "./RemoteFileTree.vue";
import GitChangesView from "./git/GitChangesView.vue";

const props = defineProps<{
  hostId: number;
  projectId: number | null;
  threadId: string;
  rootPath: string;
  visible: boolean;
}>();
const emit = defineEmits<{
  open: [path: string, view?: "source" | "changes"];
  reviewOpened: [];
}>();
const activeView = ref<"files" | "changes">("files");
const git = useFileGitWorkspace({
  hostId: () => props.hostId,
  projectId: () => props.projectId,
  rootPath: () => props.rootPath,
});
const changeCount = computed(() => git.changes.value.length);
const reviewPanels = useFileGitReviewPanelStore();
const workspaceLayout = useGatewayWorkspaceLayoutStore();

function openReview(selectedPath: string | null = null) {
  const scopeKey = workspaceLayoutScopeKey(props.hostId, props.projectId, props.threadId);
  reviewPanels.open(scopeKey, selectedPath);
  workspaceLayout.requestPanelActivation(GIT_REVIEW_WORKSPACE_PANEL_ID);
  emit("reviewOpened");
}

function openChange(path: string, change: RemoteGitWorkspaceFile) {
  // A deleted worktree path cannot be opened by the regular remote-file transport. Route that one
  // status to the shared review panel, which renders HEAD against an empty current document.
  if (change.status === "deleted") {
    openReview(path);
    return;
  }
  emit("open", path, "changes");
}
</script>

<template>
  <!--
    Both views own an internal scrollport, so the Tabs root and active content must complete the
    flex height chain. Intrinsic block sizing collapses the tree after a narrow Dockview split even
    though its rows remain mounted; keep inactive content hidden instead of conditionally mounting
    it so tree expansion and scroll state survive view switches.
  -->
  <Tabs v-model="activeView" class="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
    <TabsList variant="line" class="h-9 shrink-0 rounded-none border-b border-hairline px-2">
      <TabsTrigger value="files" class="gap-1.5">
        <FilesIcon class="size-3.5" />
        {{ $t("app.filesTab") }}
      </TabsTrigger>
      <TabsTrigger value="changes" class="gap-1.5">
        <GitCompareArrowsIcon class="size-3.5" />
        {{ $t("app.fileGitChanges") }}
        <span v-if="changeCount > 0" class="tabular-nums text-[0.6875rem] text-ink-faint">
          {{ changeCount }}
        </span>
      </TabsTrigger>
    </TabsList>
    <TabsContent
      value="files"
      :unmount-on-hide="false"
      class="m-0 flex min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
    >
      <RemoteFileTree
        :host-id="hostId"
        :project-id="projectId"
        :thread-id="threadId"
        :root-path="rootPath"
        :visible="visible && activeView === 'files'"
        @open="emit('open', $event)"
      />
    </TabsContent>
    <TabsContent
      value="changes"
      :unmount-on-hide="false"
      class="m-0 flex min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
    >
      <GitChangesView
        :host-id="hostId"
        :project-id="projectId"
        :root-path="rootPath"
        :can-promote="projectId !== null"
        @open="openChange"
        @open-review="openReview"
      />
    </TabsContent>
  </Tabs>
</template>
