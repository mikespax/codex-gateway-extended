import { computed, type Ref, watch } from "vue";
import type { FilePreviewDocument, RemoteGitFileStatus } from "~~/shared/types";
import { useFileGitComparisonStore } from "@/stores/file-workspace/git";

export function useFileGitComparison(document: Ref<FilePreviewDocument>) {
  const store = useFileGitComparisonStore();
  const state = computed(() => store.stateFor(document.value));
  const comparison = computed(() => state.value.comparison);
  const available = computed(() => comparison.value?.availability === "available");
  const baselineText = computed(() => state.value.baselineText);
  const currentText = computed(() => {
    const current = comparison.value;
    // A remotely deleted clean document still retains its last loaded bytes for inspection. Git's
    // worktree side is nevertheless empty; only an explicit local edit turns that retained text
    // into a frontend draft that should appear on the right side of the comparison.
    return current?.availability === "available" &&
      current.status === "deleted" &&
      !document.value.dirty
      ? ""
      : document.value.draftText;
  });
  const hasChanges = computed(() => {
    const baseline = baselineText.value;
    return baseline !== null && baseline !== currentText.value;
  });
  const status = computed<RemoteGitFileStatus | null>(() => {
    const current = comparison.value;
    if (current?.availability !== "available") return null;
    const baseline = baselineText.value;
    if (baseline === null) return current.status;
    if (baseline !== document.value.draftText) {
      return current.status === "clean" ? "modified" : current.status;
    }
    // Only content-only states collapse to clean. A rename, untracked file, or conflict remains a
    // Git change even when the draft bytes happen to equal the comparison baseline.
    return current.status === "clean" || current.status === "modified" ? "clean" : current.status;
  });
  const unavailableReason = computed(() => {
    const current = comparison.value;
    return current?.availability === "available" && current.baseline.kind === "unavailable"
      ? current.baseline.reason
      : null;
  });

  watch(
    () =>
      [
        document.value.key,
        document.value.projectId,
        document.value.previewKind,
        document.value.objectUrl,
        document.value.size,
        document.value.stale,
        document.value.updatedAt,
      ] as const,
    () => void store.load(document.value),
    { immediate: true },
  );

  return {
    state,
    comparison,
    available,
    baselineText,
    currentText,
    hasChanges,
    status,
    unavailableReason,
    refresh: () => store.load(document.value, true),
  };
}
