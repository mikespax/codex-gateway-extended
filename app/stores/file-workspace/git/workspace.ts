import { defineStore } from "pinia";
import { reactive, shallowRef } from "vue";
import type { RemoteGitWorkspaceFile } from "~~/shared/types";
import { inspectRemoteGitWorkspace } from "./workspace-transport";
import { gitWorkspaceKey, workspacePathForGitChange } from "./workspace-paths";
import type { FileGitWorkspaceState, GitWorkspaceScopeInput } from "./workspace-types";
import { emptyGitWorkspaceIndex, indexGitWorkspaceSnapshot } from "./workspace-index";

export const useFileGitWorkspaceStore = defineStore("file-git-workspaces", () => {
  const states = shallowRef<Record<string, FileGitWorkspaceState>>({});
  const pending = new Map<string, Promise<FileGitWorkspaceState>>();
  const versions = new Map<string, number>();

  function stateFor(input: GitWorkspaceScopeInput) {
    const key = gitWorkspaceKey(input);
    const existing = states.value[key];
    if (existing !== undefined) return existing;
    const state = reactive<FileGitWorkspaceState>({
      ...input,
      key,
      loading: false,
      loaded: false,
      stale: true,
      error: null,
      snapshot: null,
      ...emptyGitWorkspaceIndex(),
    });
    states.value = { ...states.value, [key]: state };
    return state;
  }

  function load(input: GitWorkspaceScopeInput, force = false): Promise<FileGitWorkspaceState> {
    const state = stateFor(input);
    if (force) invalidate(input);
    if (!state.stale && state.loaded) return Promise.resolve(state);
    const active = pending.get(state.key);
    if (active !== undefined) return active;
    state.loading = true;
    state.error = null;
    let tracked: Promise<FileGitWorkspaceState>;
    tracked = loadCurrentVersion(input, state).finally(() => {
      state.loading = false;
      if (pending.get(state.key) === tracked) pending.delete(state.key);
    });
    pending.set(state.key, tracked);
    return tracked;
  }

  function invalidate(input: GitWorkspaceScopeInput) {
    const state = stateFor(input);
    versions.set(state.key, versionFor(state.key) + 1);
    state.stale = true;
  }

  async function loadCurrentVersion(
    input: GitWorkspaceScopeInput,
    state: FileGitWorkspaceState,
  ): Promise<FileGitWorkspaceState> {
    // A save/delete event can invalidate Git while the previous SSH status command is still in
    // flight. Keep one browser request pipeline and immediately repeat inside it until the version
    // observed before the request is still current. Do not let a late response clear `stale`, and
    // do not launch parallel status commands to compensate for that race.
    while (true) {
      const requestedVersion = versionFor(state.key);
      try {
        const snapshot = await inspectRemoteGitWorkspace(input);
        if (requestedVersion !== versionFor(state.key)) continue;
        state.snapshot = snapshot;
        Object.assign(state, indexGitWorkspaceSnapshot(input, snapshot));
        state.loaded = true;
        state.stale = false;
        state.error = null;
        return state;
      } catch (error: unknown) {
        if (requestedVersion !== versionFor(state.key)) continue;
        state.error = error instanceof Error ? error.message : String(error);
        state.stale = true;
        return state;
      }
    }
  }

  function versionFor(key: string) {
    return versions.get(key) ?? 0;
  }

  function changesFor(input: GitWorkspaceScopeInput) {
    return stateFor(input).changes;
  }

  function changeForPath(input: GitWorkspaceScopeInput, path: string) {
    return stateFor(input).changeByPath.get(path) ?? null;
  }

  function descendantChangeCount(input: GitWorkspaceScopeInput, path: string) {
    return stateFor(input).descendantChangeCountByPath.get(path) ?? 0;
  }

  function pathForChange(input: GitWorkspaceScopeInput, change: RemoteGitWorkspaceFile) {
    const snapshot = stateFor(input).snapshot;
    return snapshot?.availability === "available"
      ? workspacePathForGitChange(input, snapshot, change)
      : null;
  }

  function reset() {
    pending.clear();
    versions.clear();
    states.value = {};
  }

  return {
    states,
    stateFor,
    load,
    invalidate,
    changesFor,
    changeForPath,
    descendantChangeCount,
    pathForChange,
    reset,
  };
});
