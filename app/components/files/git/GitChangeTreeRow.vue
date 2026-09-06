<script setup lang="ts">
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from "@lucide/vue";
import { TreeItem } from "reka-ui";
import { gitStatusTextClass } from "@/utils/git-status-presentation";
import type { GitChangeTreeNode } from "./git-change-tree";
import GitStatusBadge from "./GitStatusBadge.vue";

defineProps<{ node: GitChangeTreeNode; level: number }>();
</script>

<template>
  <TreeItem
    v-slot="{ isExpanded }"
    :value="node"
    :level="level"
    :data-git-change-path="node.path"
    class="flex h-8 w-full min-w-0 cursor-default items-center gap-1.5 rounded-md pr-2 text-sm text-ink-muted outline-none hover:bg-canvas-soft hover:text-ink data-selected:bg-primary/10 data-selected:text-ink"
    :style="{ paddingInlineStart: `${Math.max(0, level - 1) * 1.125 + 0.5}rem` }"
  >
    <ChevronRightIcon
      v-if="node.kind === 'directory'"
      class="size-3.5 shrink-0 transition-transform"
      :class="isExpanded ? 'rotate-90' : ''"
    />
    <span v-else class="w-3.5 shrink-0" />
    <FolderOpenIcon
      v-if="node.kind === 'directory' && isExpanded"
      class="size-4 shrink-0 text-primary"
    />
    <FolderIcon v-else-if="node.kind === 'directory'" class="size-4 shrink-0 text-primary" />
    <FileIcon v-else class="size-4 shrink-0 text-ink-faint" />
    <span
      class="min-w-0 flex-1 truncate"
      :class="node.kind === 'file' ? gitStatusTextClass(node.change.status) : ''"
      :title="node.path"
    >
      {{ node.name }}
    </span>
    <GitStatusBadge v-if="node.kind === 'file'" :status="node.change.status" />
  </TreeItem>
</template>
