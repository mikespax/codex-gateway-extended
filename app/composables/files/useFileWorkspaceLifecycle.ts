import { useEventListener } from "@vueuse/core";
import type { MaybeRefOrGetter } from "vue";
import { toValue, watch } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useFileGitWorkspaceStore } from "@/stores/file-workspace/git/workspace";

export function useFileWorkspaceLifecycle(input: {
  hostId: MaybeRefOrGetter<number>;
  projectId: MaybeRefOrGetter<number | null>;
  threadId: MaybeRefOrGetter<string>;
  rootPath: MaybeRefOrGetter<string>;
  active: MaybeRefOrGetter<boolean>;
}) {
  const workspace = useGatewayFileWorkspaceStore();
  const gitWorkspace = useFileGitWorkspaceStore();
  const auth = useAuthStore();
  auth.hydrate();

  const revalidate = () => {
    if (!auth.isAuthenticated) return Promise.resolve([]);
    return Promise.all([
      workspace.revalidateActiveFile(toValue(input.hostId), toValue(input.threadId)),
      workspace.refreshExpandedDirectories(toValue(input.hostId), toValue(input.threadId)),
      refreshGitWorkspace(),
    ]);
  };

  const refreshGitWorkspace = () => {
    const projectId = toValue(input.projectId);
    const rootPath = toValue(input.rootPath);
    if (projectId === null || rootPath === "") return Promise.resolve(null);
    return gitWorkspace.load({ hostId: toValue(input.hostId), projectId, rootPath });
  };

  watch(
    () =>
      [
        toValue(input.hostId),
        toValue(input.projectId),
        toValue(input.threadId),
        toValue(input.rootPath),
        auth.isAuthenticated,
      ] as const,
    async ([hostId, projectId, threadId, rootPath, authenticated]) => {
      if (!rootPath || !authenticated) return;
      workspace.setScopeRoot({ hostId, projectId, threadId, rootPath });
      await workspace.restoreScope(hostId, threadId);
      if (projectId !== null) await gitWorkspace.load({ hostId, projectId, rootPath });
    },
    { immediate: true },
  );
  watch(
    () => toValue(input.active),
    (active) => active === true && void revalidate(),
    { immediate: true },
  );
  watch(
    () => workspace.activeDocumentFor(toValue(input.hostId), toValue(input.threadId))?.stale,
    (stale) =>
      stale === true &&
      toValue(input.active) === true &&
      void workspace.revalidateActiveFile(toValue(input.hostId), toValue(input.threadId)),
  );
  useEventListener(document, "visibilitychange", () => {
    if (document.visibilityState === "visible" && toValue(input.active) === true) void revalidate();
  });
}
