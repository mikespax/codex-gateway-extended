<script setup lang="ts">
import type { IDockviewPanelProps } from "dockview-vue";
import { computed } from "vue";
import GitChangesView from "@/components/files/git/GitChangesView.vue";
import { useFileGitReviewPanelStore } from "@/stores/file-workspace/git/review-panel";
import { workspaceLayoutScopeKey } from "@/stores/gateway-workspace-layout";
import type { WorkspaceDockPanelParamsFor } from "./types";
import { requireWorkspaceFilesPanelContext } from "./context";

defineProps<{ params: IDockviewPanelProps<WorkspaceDockPanelParamsFor<"gitReview">> }>();
const context = requireWorkspaceFilesPanelContext();
const reviews = useFileGitReviewPanelStore();
const scopeKey = computed(() =>
  workspaceLayoutScopeKey(
    context.selectedHostId.value,
    context.selectedProjectId.value,
    context.selectedThreadId.value,
  ),
);
const selectedPath = computed(() => reviews.selectedPathFor(scopeKey.value));
</script>

<template>
  <div data-testid="git-review-panel" class="flex h-full min-h-0 flex-col overflow-hidden">
    <GitChangesView
      v-if="context.selectedHostId.value && context.selectedProjectId.value"
      presentation="review"
      :host-id="context.selectedHostId.value"
      :project-id="context.selectedProjectId.value"
      :root-path="context.rootPath.value"
      :selected-path="selectedPath"
      @select="reviews.select(scopeKey, $event)"
    />
  </div>
</template>
