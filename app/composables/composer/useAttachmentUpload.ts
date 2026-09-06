import { ref, type Ref } from "vue";
import { gatewayApi } from "@/utils/gateway-api";
import type { UploadedFileRecord } from "~~/shared/types";
import type { ComposerAttachment } from "./useComposerDraft";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";
import { captureSessionEpoch } from "@/utils/session-epoch";

export function useAttachmentUpload(
  selectedHostId: Ref<number | null>,
  attachedFiles: Ref<ComposerAttachment[]>,
) {
  const store = useGatewayBootstrapStore();
  const { t } = useI18n();
  const uploadInputRef = ref<HTMLInputElement | null>(null);
  const uploadingAttachments = ref(false);
  let pendingFileAdds = Promise.resolve();
  let pendingBatchCount = 0;

  function openAttachmentPicker() {
    uploadInputRef.value?.click();
  }

  async function dataUrlFromFile(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () =>
        resolve(typeof reader.result === "string" ? reader.result : ""),
      );
      reader.addEventListener("error", () =>
        reject(reader.error || new Error("Failed to read file")),
      );
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(files: File[], sessionIsCurrent: () => boolean) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const otherFiles = files.filter((file) => !file.type.startsWith("image/"));
    const imageAttachments: ComposerAttachment[] = [];

    for (const file of images) {
      const dataUrl = await dataUrlFromFile(file);
      if (!sessionIsCurrent()) return;
      imageAttachments.push({
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
        name: file.name || "pasted-image.png",
        path: "",
        mimeType: file.type || null,
        size: file.size,
        isImage: true,
        dataUrl,
      });
    }

    if (imageAttachments.length > 0) attachedFiles.value.push(...imageAttachments);

    if (otherFiles.length === 0 || selectedHostId.value === null) {
      return;
    }

    const hostId = selectedHostId.value;
    try {
      const form = new FormData();
      for (const file of otherFiles) {
        form.append("files", file, file.name);
      }
      const result = await gatewayApi<{ files: UploadedFileRecord[] }>("/api/uploads", {
        method: "POST",
        query: { hostId },
        body: form,
      });
      if (!sessionIsCurrent() || selectedHostId.value !== hostId) return;
      attachedFiles.value.push(
        ...result.files.map((file) => ({
          ...file,
          id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
        })),
      );
    } catch (error: unknown) {
      if (!sessionIsCurrent()) return;
      store.setError(
        messageFromError(error, t("app.uploadAttachmentFailed"), errorMessageLabels(t)),
        { hostId },
      );
    }
  }

  function queueFiles(files: File[]) {
    if (files.length === 0) return;
    const sessionIsCurrent = captureSessionEpoch();
    pendingBatchCount += 1;
    uploadingAttachments.value = true;
    pendingFileAdds = pendingFileAdds
      .catch(() => undefined)
      .then(() => addFiles(files, sessionIsCurrent))
      .catch((error: unknown) => {
        if (!sessionIsCurrent()) return;
        store.setError(
          messageFromError(error, t("app.uploadAttachmentFailed"), errorMessageLabels(t)),
          { hostId: selectedHostId.value },
        );
      })
      .finally(() => {
        pendingBatchCount = Math.max(0, pendingBatchCount - 1);
        uploadingAttachments.value = pendingBatchCount > 0;
      });
  }

  function handleAttachmentChange(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    queueFiles(Array.from(input.files ?? []));
    input.value = "";
  }

  function handlePaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    queueFiles(files);
  }

  function handleDrop(event: DragEvent) {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    queueFiles(files);
  }

  function removeAttachment(id: string) {
    attachedFiles.value = attachedFiles.value.filter((file) => file.id !== id);
  }

  return {
    uploadInputRef,
    uploadingAttachments,
    openAttachmentPicker,
    handleAttachmentChange,
    handlePaste,
    handleDrop,
    removeAttachment,
  };
}
