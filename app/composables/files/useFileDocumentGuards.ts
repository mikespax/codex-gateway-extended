import type { MaybeRefOrGetter } from "vue";
import { computed, ref, toValue } from "vue";
import type { FilePreviewDocument } from "~~/shared/types";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";

export function useFileDocumentGuards(input: {
  hostId: MaybeRefOrGetter<number>;
  threadId: MaybeRefOrGetter<string>;
}) {
  const workspace = useGatewayFileWorkspaceStore();
  const pendingCloseDocument = ref<FilePreviewDocument | null>(null);
  const conflictDocument = ref<FilePreviewDocument | null>(null);
  const documents = computed(() =>
    workspace.documentsForScope(toValue(input.hostId), toValue(input.threadId)),
  );

  function requestClose(path: string) {
    const document = documents.value.find((candidate) => candidate.path === path);
    if (document?.dirty === true) pendingCloseDocument.value = document;
    else workspace.closeFile(toValue(input.hostId), toValue(input.threadId), path);
  }
  async function saveAndClose() {
    const document = pendingCloseDocument.value;
    if (document === null || !(await workspace.saveDocument(document))) return;
    pendingCloseDocument.value = null;
    workspace.closeFile(document.hostId, document.threadId, document.path);
  }
  function discardAndClose() {
    const document = pendingCloseDocument.value;
    if (document === null) return;
    pendingCloseDocument.value = null;
    workspace.closeFile(document.hostId, document.threadId, document.path);
  }
  async function discardConflict() {
    const document = conflictDocument.value;
    if (document === null) return;
    conflictDocument.value = null;
    await workspace.discardDocumentDraft(document);
  }
  async function overwriteConflict() {
    const document = conflictDocument.value;
    if (document !== null && (await workspace.saveDocument(document, true))) {
      conflictDocument.value = null;
    }
  }

  return {
    pendingCloseDocument,
    conflictDocument,
    requestClose,
    saveAndClose,
    discardAndClose,
    discardConflict,
    overwriteConflict,
  };
}
