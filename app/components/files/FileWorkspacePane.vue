<script setup lang="ts">
import { FilesIcon } from "@lucide/vue";
import { computed, ref, toRefs } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@codex-gateway/ui/sheet";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useFileWorkspaceLifecycle } from "@/composables/files/useFileWorkspaceLifecycle";
import { useFileDocumentGuards } from "@/composables/files/useFileDocumentGuards";
import FilePreviewViewport from "./FilePreviewViewport.vue";
import FileCloseDialog from "./FileCloseDialog.vue";
import FileConflictDialog from "./FileConflictDialog.vue";
import FileWorkspaceSplitPane from "./FileWorkspaceSplitPane.vue";
import FileWorkspaceTabs from "./FileWorkspaceTabs.vue";
import FileWorkspaceSidebar from "./FileWorkspaceSidebar.vue";

const props = defineProps<{
  layout: "desktop" | "mobile";
  hostId: number;
  projectId: number | null;
  threadId: string;
  rootPath: string;
  active: boolean;
}>();

const fileWorkspace = useGatewayFileWorkspaceStore();
const mobileTreeOpen = ref(false);
const refs = toRefs(props);
useFileWorkspaceLifecycle(refs);
const guards = useFileDocumentGuards(refs);
const { pendingCloseDocument, conflictDocument } = guards;
const scope = computed(() => fileWorkspace.scopeFor(props.hostId, props.threadId));
const documents = computed(() => fileWorkspace.documentsForScope(props.hostId, props.threadId));
const activeDocument = computed(() =>
  fileWorkspace.activeDocumentFor(props.hostId, props.threadId),
);

function openFile(path: string, view?: "source" | "changes") {
  mobileTreeOpen.value = false;
  void fileWorkspace.openFile({
    hostId: props.hostId,
    projectId: props.projectId,
    threadId: props.threadId,
    path,
    view,
  });
}
</script>

<template>
  <div data-testid="workspace-file-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <FileWorkspaceSplitPane v-if="layout === 'desktop'">
      <template #tree>
        <FileWorkspaceSidebar
          :host-id="hostId"
          :project-id="projectId"
          :thread-id="threadId"
          :root-path="rootPath"
          :visible="active"
          @open="openFile"
          @review-opened="mobileTreeOpen = false"
        />
      </template>
      <template #preview>
        <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
          <FileWorkspaceTabs
            :documents="documents"
            :active-path="scope?.activePath ?? null"
            :host-id="hostId"
            :project-id="projectId"
            :root-path="rootPath"
            @activate="fileWorkspace.activateFile(hostId, threadId, $event)"
            @close="guards.requestClose"
          />
          <FilePreviewViewport
            v-if="activeDocument"
            :document="activeDocument"
            @conflict="conflictDocument = activeDocument"
          />
          <div
            v-else
            class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-canvas text-center text-ink-muted"
          >
            <FilesIcon class="size-9 text-ink-faint" />
            <div>
              <div class="text-sm font-medium text-ink">{{ $t("app.noOpenFiles") }}</div>
              <div class="mt-1 text-xs">{{ $t("app.chooseFileFromTree") }}</div>
            </div>
          </div>
        </div>
      </template>
    </FileWorkspaceSplitPane>

    <template v-else>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div class="flex shrink-0 items-stretch border-b border-hairline">
          <Button
            variant="ghost"
            size="sm"
            class="h-10 shrink-0 rounded-none border-r border-hairline px-3"
            @click="mobileTreeOpen = true"
          >
            <FilesIcon class="size-4" />
            {{ $t("app.fileTree") }}
          </Button>
          <FileWorkspaceTabs
            class="min-w-0 flex-1 border-b-0"
            :documents="documents"
            :active-path="scope?.activePath ?? null"
            :host-id="hostId"
            :project-id="projectId"
            :root-path="rootPath"
            @activate="fileWorkspace.activateFile(hostId, threadId, $event)"
            @close="guards.requestClose"
          />
        </div>
        <FilePreviewViewport
          v-if="activeDocument"
          :document="activeDocument"
          @conflict="conflictDocument = activeDocument"
        />
        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center gap-3 bg-canvas text-center text-ink-muted"
        >
          <FilesIcon class="size-9 text-ink-faint" />
          <Button variant="outline" size="sm" @click="mobileTreeOpen = true">
            {{ $t("app.openFileTree") }}
          </Button>
        </div>
      </div>

      <Sheet v-model:open="mobileTreeOpen">
        <SheetContent side="left" class="w-[min(88vw,24rem)] p-0">
          <SheetHeader class="sr-only">
            <SheetTitle>{{ $t("app.fileTree") }}</SheetTitle>
            <SheetDescription>{{ rootPath }}</SheetDescription>
          </SheetHeader>
          <FileWorkspaceSidebar
            :host-id="hostId"
            :project-id="projectId"
            :thread-id="threadId"
            :root-path="rootPath"
            :visible="mobileTreeOpen"
            @open="openFile"
            @review-opened="mobileTreeOpen = false"
          />
        </SheetContent>
      </Sheet>
    </template>
    <FileCloseDialog
      :document="pendingCloseDocument"
      @cancel="pendingCloseDocument = null"
      @discard="guards.discardAndClose"
      @save="guards.saveAndClose"
    />
    <FileConflictDialog
      :document="conflictDocument"
      @close="conflictDocument = null"
      @discard="guards.discardConflict"
      @overwrite="guards.overwriteConflict"
    />
  </div>
</template>
