import { ref, watch } from "vue";

import { storeToRefs } from "pinia";
import type { UploadedFileRecord } from "~~/shared/types";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { selectedThreadKey } from "@/stores/gateway/thread-utils/identity";
import type { ComposerFileReference } from "@/stores/gateway/types";

export type ComposerAttachment = UploadedFileRecord & { id: string; dataUrl?: string };

export function useComposerDraft() {
  const composer = useGatewayComposerStore();
  const navigation = useGatewayNavigationStore();
  const { selectedHostId, selectedThreadId } = storeToRefs(navigation);
  const turnText = ref("");
  const attachedFiles = ref<ComposerAttachment[]>([]);
  const fileReferences = ref<ComposerFileReference[]>([]);
  let activeHostId: number | null = null;
  let activeThreadId: string | null = null;
  let syncingDraft = false;

  watch(
    [selectedHostId, selectedThreadId],
    ([hostId, threadId]) => {
      syncingDraft = true;
      activeHostId = hostId;
      activeThreadId = threadId;
      const key = selectedThreadKey(hostId, threadId);
      const draft = key === null ? undefined : composer.composerDraftsByKey[key];
      turnText.value = draft?.text ?? "";
      attachedFiles.value = [...(draft?.attachedFiles ?? [])];
      fileReferences.value = [...(draft?.fileReferences ?? [])];
      syncingDraft = false;
    },
    // Scope changes and local v-model writes are one transaction. A deferred watcher can observe
    // the new navigation scope while persisting the old textarea value and leak a draft between
    // threads, so both hydration and persistence intentionally run synchronously.
    { flush: "sync", immediate: true },
  );

  watch(
    [turnText, attachedFiles, fileReferences],
    () => {
      if (syncingDraft || activeHostId === null || activeThreadId === null) {
        return;
      }
      composer.saveComposerDraft(activeHostId, activeThreadId, {
        text: turnText.value,
        attachedFiles: attachedFiles.value,
        fileReferences: fileReferences.value,
      });
    },
    { deep: true, flush: "sync" },
  );

  function clearDraft() {
    turnText.value = "";
    attachedFiles.value = [];
    fileReferences.value = [];
    if (activeHostId !== null && activeThreadId !== null) {
      composer.clearComposerDraft(activeHostId, activeThreadId);
    }
  }

  return {
    turnText,
    attachedFiles,
    fileReferences,
    clearDraft,
  };
}
