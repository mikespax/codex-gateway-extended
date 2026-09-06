import { computed, type MaybeRefOrGetter, toValue } from "vue";
import type { RemoteGitWorkspaceFile } from "~~/shared/types";
import { useFileGitWorkspaceStore } from "@/stores/file-workspace/git/workspace";

export function useFileGitWorkspace(input: {
  hostId: MaybeRefOrGetter<number>;
  projectId: MaybeRefOrGetter<number | null>;
  rootPath: MaybeRefOrGetter<string>;
}) {
  const store = useFileGitWorkspaceStore();
  const scope = computed(() => {
    const projectId = toValue(input.projectId);
    const rootPath = toValue(input.rootPath);
    return projectId === null || rootPath === ""
      ? null
      : { hostId: toValue(input.hostId), projectId, rootPath };
  });
  const state = computed(() => (scope.value === null ? null : store.stateFor(scope.value)));
  const changes = computed(() => (scope.value === null ? [] : store.changesFor(scope.value)));

  return {
    scope,
    state,
    changes,
    load: () => (scope.value === null ? Promise.resolve(null) : store.load(scope.value)),
    refresh: () => (scope.value === null ? Promise.resolve(null) : store.load(scope.value, true)),
    changeForPath: (path: string) =>
      scope.value === null ? null : store.changeForPath(scope.value, path),
    descendantChangeCount: (path: string) =>
      scope.value === null ? 0 : store.descendantChangeCount(scope.value, path),
    pathForChange: (change: RemoteGitWorkspaceFile) =>
      scope.value === null ? null : store.pathForChange(scope.value, change),
  };
}
