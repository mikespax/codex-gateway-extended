import { defineStore } from "pinia";
import { reactive, shallowRef } from "vue";
import { MAX_EDITABLE_FILE_BYTES } from "~~/shared/file-preview";
import type { FilePreviewDocument, RemoteGitFileComparison } from "~~/shared/types";
import { compareRemoteGitFile } from "./transport";
import type { FileGitComparisonState, FileGitComparisonTarget } from "./types";

export const useFileGitComparisonStore = defineStore("file-git-comparisons", () => {
  const states = shallowRef<Record<string, FileGitComparisonState>>({});
  const requestTokens = new Map<string, symbol>();
  const pendingLoads = new Map<string, Promise<FileGitComparisonState>>();

  function register(document: FilePreviewDocument) {
    return document.projectId === null
      ? stateForUnavailableDocument(document.key)
      : stateForTarget(target(document));
  }

  function stateFor(document: FilePreviewDocument) {
    return register(document);
  }

  function stateForTarget(input: FileGitComparisonTarget) {
    const key = comparisonKey(input);
    const existing = states.value[key];
    if (existing !== undefined) return existing;
    const state = createState(key);
    states.value = { ...states.value, [key]: state };
    return state;
  }

  function stateForUnavailableDocument(documentKey: string) {
    const key = `unavailable:${documentKey}`;
    const existing = states.value[key];
    if (existing !== undefined) return existing;
    const state = createState(key);
    states.value = { ...states.value, [key]: state };
    return state;
  }

  function load(document: FilePreviewDocument, force = false) {
    const state = stateFor(document);
    if (!canCompare(document) || document.projectId === null) {
      clearResult(state);
      state.stale = false;
      state.loading = false;
      return Promise.resolve(state);
    }
    return loadTarget(target(document), force);
  }

  function loadTarget(
    input: FileGitComparisonTarget,
    force = false,
  ): Promise<FileGitComparisonState> {
    const state = stateForTarget(input);
    if (force) invalidateTarget(input);
    if (!force && state.loaded && !state.stale) return Promise.resolve(state);
    const pending = pendingLoads.get(state.key);
    if (pending !== undefined) {
      // One path has one browser-side comparison request regardless of whether the Files editor or
      // the review panel asked first. Invalidations wait for that request to settle before issuing
      // a fresh read, matching the server's per-host SSH singleflight.
      return pending.then(() => (state.stale ? loadTarget(input) : state));
    }

    const token = Symbol(state.key);
    requestTokens.set(state.key, token);
    state.loading = true;
    state.error = null;
    let tracked: Promise<FileGitComparisonState>;
    tracked = performLoad(input, state, token).finally(() => {
      if (pendingLoads.get(state.key) === tracked) pendingLoads.delete(state.key);
    });
    pendingLoads.set(state.key, tracked);
    return tracked;
  }

  async function performLoad(
    input: FileGitComparisonTarget,
    state: FileGitComparisonState,
    token: symbol,
  ) {
    try {
      const comparison = await compareRemoteGitFile(input);
      if (requestTokens.get(state.key) !== token) return state;
      state.comparison = comparison;
      state.baselineText = baselineText(comparison);
      state.loaded = true;
      state.stale = false;
      return state;
    } catch (error: unknown) {
      if (requestTokens.get(state.key) !== token) return state;
      state.error = error instanceof Error ? error.message : String(error);
      state.stale = true;
      return state;
    } finally {
      if (requestTokens.get(state.key) === token) {
        requestTokens.delete(state.key);
        state.loading = false;
      }
    }
  }

  function invalidate(document: FilePreviewDocument) {
    if (document.projectId !== null) invalidateTarget(target(document));
  }

  function invalidateTarget(input: FileGitComparisonTarget) {
    const key = comparisonKey(input);
    const state = states.value[key];
    if (state !== undefined) state.stale = true;
    requestTokens.delete(key);
  }

  function reset() {
    requestTokens.clear();
    pendingLoads.clear();
    states.value = {};
  }

  return {
    states,
    register,
    stateFor,
    stateForTarget,
    load,
    loadTarget,
    invalidate,
    invalidateTarget,
    reset,
  };
});

function target(document: FilePreviewDocument): FileGitComparisonTarget {
  if (document.projectId === null) {
    throw new Error("A project is required to compare a remote Git file");
  }
  return { hostId: document.hostId, projectId: document.projectId, path: document.path };
}

function comparisonKey(input: FileGitComparisonTarget) {
  return `${input.hostId}:${input.projectId}:${input.path}`;
}

function createState(key: string) {
  return reactive<FileGitComparisonState>({
    key,
    loading: false,
    loaded: false,
    stale: true,
    error: null,
    comparison: null,
    baselineText: null,
  });
}

function canCompare(document: FilePreviewDocument) {
  return (
    document.projectId !== null &&
    document.previewKind === "text" &&
    document.objectUrl !== "" &&
    !document.stale &&
    (document.size ?? 0) <= MAX_EDITABLE_FILE_BYTES
  );
}

function baselineText(comparison: RemoteGitFileComparison) {
  if (comparison.availability !== "available") return null;
  switch (comparison.baseline.kind) {
    case "head":
      return comparison.baseline.text;
    case "empty":
      return "";
    case "unavailable":
      return null;
  }
}

function clearResult(state: FileGitComparisonState) {
  state.loaded = false;
  state.error = null;
  state.comparison = null;
  state.baselineText = null;
}
