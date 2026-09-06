<script setup lang="ts">
import type { ThreadFileChange, ThreadHistoryItem } from "~~/shared/types";
import { ChevronDownIcon, ChevronRightIcon, FilePenIcon, Loader2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@codex-gateway/ui/collapsible";
import FileChangeApprovalBar from "./FileChangeApprovalBar.vue";
import FileChangeDiffPanel from "./FileChangeDiffPanel.vue";
import FileChangeOutputPanel from "./FileChangeOutputPanel.vue";
import { fileChangeKey, fileChangeKind, fileChangePath } from "./utils";
import { useFilePreviewContext } from "@/composables/files/useFilePreviewContext";
import { workspacePathDisplayLabel } from "@/utils/thread-item-display";
import { threadItemResultText } from "@/utils/thread-items";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  threadId: string | null;
  hideDetails?: boolean;
}>();
const { t } = useI18n();
const filePreviewContext = useFilePreviewContext();
const fileChanges = computed(() => (Array.isArray(props.item.changes) ? props.item.changes : []));
const openChangeKeys = ref(new Set<string>());
const initializedChangeKeys = new Set<string>();
const output = computed(() => props.item.aggregatedOutput || threadItemResultText(props.item));
const itemStatus = computed(() =>
  typeof props.item.status === "string" ? props.item.status : props.item.status?.type,
);
const pendingApproval = computed(() => props.item.pendingApproval || null);
const aggregatedStepCount = computed(() => {
  const value = props.item.aggregatedStepCount;
  return typeof value === "number" && Number.isInteger(value) && value > 1 ? value : 1;
});
const isInProgress = computed(() => {
  const value = itemStatus.value;
  return value === "inProgress" || value === "running" || value === "active";
});
const title = computed(() => {
  if (isInProgress.value && !fileChanges.value.length) {
    return t("app.editingFiles");
  }
  if (aggregatedStepCount.value > 1) {
    return t("app.filesChangedAcrossSteps", {
      files: fileChanges.value.length,
      steps: aggregatedStepCount.value,
    });
  }
  return t("app.filesChanged", { count: fileChanges.value.length });
});

function changeKindLabel(change: ThreadFileChange) {
  const kind = fileChangeKind(change).toLowerCase();
  if (kind.includes("add") || kind === "create") return t("app.fileAdded");
  if (kind.includes("delete") || kind === "remove") return t("app.fileDeleted");
  if (kind.includes("move") || kind.includes("rename")) return t("app.fileMoved");
  return t("app.fileUpdated");
}

function changeDisplayPath(change: ThreadFileChange) {
  return workspacePathDisplayLabel(fileChangePath(change), filePreviewContext?.workspaceRoot.value);
}

function isChangeOpen(change: ThreadFileChange) {
  return openChangeKeys.value.has(fileChangeKey(change));
}

function setChangeOpen(change: ThreadFileChange, open: boolean) {
  const next = new Set(openChangeKeys.value);
  const key = fileChangeKey(change);
  if (open) {
    next.add(key);
  } else {
    next.delete(key);
  }
  openChangeKeys.value = next;
}

watch(
  () => fileChanges.value.map((change) => fileChangeKey(change)),
  (changes) => {
    const currentKeys = new Set(changes);
    const nextOpenKeys = new Set([...openChangeKeys.value].filter((key) => currentKeys.has(key)));
    for (const key of initializedChangeKeys) {
      if (!currentKeys.has(key)) initializedChangeKeys.delete(key);
    }
    for (const key of changes) {
      if (initializedChangeKeys.has(key)) continue;
      initializedChangeKeys.add(key);
      nextOpenKeys.add(key);
    }
    // A visible file change starts expanded, matching the Agent timeline's historical behavior.
    // Once the user closes it, keep the expensive diff renderer unmounted and remember that choice
    // while streaming updates mutate the same change. New files still open on first appearance.
    openChangeKeys.value = nextOpenKeys;
  },
  { immediate: true },
);
</script>

<template>
  <div class="max-w-4xl text-ink-secondary">
    <div data-testid="file-change-summary" class="flex items-center gap-2 text-[0.9375rem]">
      <Loader2Icon v-if="isInProgress" class="size-4 animate-spin text-primary" />
      <FilePenIcon v-else class="size-4" />
      <span>{{ title }}</span>
      <Badge v-if="itemStatus" variant="secondary">{{ itemStatus }}</Badge>
      <Badge v-if="pendingApproval" variant="outline">{{ t("app.waitingApproval") }}</Badge>
      <Badge v-if="isInProgress" variant="outline">{{ t("app.running") }}</Badge>
    </div>
    <div v-if="pendingApproval">
      <FileChangeApprovalBar
        :pending-approval="pendingApproval"
        :host-id="hostId"
        :thread-id="threadId"
        :presentation-id="`file-${String(item.id ?? item.turnId ?? 'request')}`"
      />
    </div>
    <div v-if="!hideDetails && fileChanges.length" class="mt-3 space-y-2">
      <FileChangeOutputPanel v-if="output" :output="output" :streaming="isInProgress" />
      <Collapsible
        v-for="change in fileChanges"
        :key="fileChangeKey(change)"
        v-slot="{ open }"
        :open="isChangeOpen(change)"
        class="rounded-lg border border-hairline bg-surface"
        @update:open="setChangeOpen(change, $event)"
      >
        <CollapsibleTrigger as-child>
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas-soft"
          >
            <ChevronDownIcon v-if="open" class="size-4 shrink-0 text-ink-faint" />
            <ChevronRightIcon v-else class="size-4 shrink-0 text-ink-faint" />
            <span
              class="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-ink-secondary"
              :title="fileChangePath(change)"
              >{{ changeDisplayPath(change) }}</span
            >
            <Badge variant="outline">{{ changeKindLabel(change) }}</Badge>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <FileChangeDiffPanel v-if="open" :change="change" :streaming="isInProgress" />
        </CollapsibleContent>
      </Collapsible>
    </div>
    <FileChangeOutputPanel
      v-else-if="!hideDetails && output"
      :output="output"
      :streaming="isInProgress"
      extra-class="mt-3"
    />
    <div
      v-else-if="!hideDetails && isInProgress"
      class="mt-3 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted"
    >
      {{ t("app.waitingFileChanges") }}
    </div>
  </div>
</template>
