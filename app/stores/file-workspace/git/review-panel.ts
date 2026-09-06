import { defineStore } from "pinia";
import { ref } from "vue";

export const useFileGitReviewPanelStore = defineStore("file-git-review-panels", () => {
  const scopes = ref<Record<string, { selectedPath: string | null }>>({});

  function open(scopeKey: string, selectedPath: string | null = null) {
    scopes.value = {
      ...scopes.value,
      [scopeKey]: {
        selectedPath: selectedPath ?? scopes.value[scopeKey]?.selectedPath ?? null,
      },
    };
  }

  function select(scopeKey: string, selectedPath: string) {
    if (scopes.value[scopeKey] === undefined) return;
    scopes.value = { ...scopes.value, [scopeKey]: { selectedPath } };
  }

  function close(scopeKey: string) {
    if (scopes.value[scopeKey] === undefined) return;
    const next = { ...scopes.value };
    delete next[scopeKey];
    scopes.value = next;
  }

  function isOpen(scopeKey: string) {
    return scopes.value[scopeKey] !== undefined;
  }

  function selectedPathFor(scopeKey: string) {
    return scopes.value[scopeKey]?.selectedPath ?? null;
  }

  function reset() {
    scopes.value = {};
  }

  return { scopes, open, select, close, isOpen, selectedPathFor, reset };
});
