import type { RemoteGitWorkspaceFile, RemoteGitWorkspaceSnapshot } from "~~/shared/types";
import { changeIsInWorkspace, workspacePathForGitChange } from "./workspace-paths";
import type { GitWorkspaceScopeInput } from "./workspace-types";

export interface GitWorkspaceIndex {
  changes: RemoteGitWorkspaceFile[];
  changeByPath: ReadonlyMap<string, RemoteGitWorkspaceFile>;
  descendantChangeCountByPath: ReadonlyMap<string, number>;
}

export function indexGitWorkspaceSnapshot(
  input: GitWorkspaceScopeInput,
  snapshot: RemoteGitWorkspaceSnapshot,
): GitWorkspaceIndex {
  if (snapshot.availability !== "available") return emptyGitWorkspaceIndex();
  const changes = snapshot.files.filter((change) => changeIsInWorkspace(snapshot, change));
  const changeByPath = new Map<string, RemoteGitWorkspaceFile>();
  const descendantChangeCountByPath = new Map<string, number>();
  const rootPath = normalize(input.rootPath);

  for (const change of changes) {
    const path = workspacePathForGitChange(input, snapshot, change);
    if (path === null) continue;
    changeByPath.set(path, change);
    for (let parent = parentPath(path); parent !== null; parent = parentPath(parent)) {
      if (parent !== rootPath && !parent.startsWith(`${rootPath === "/" ? "" : rootPath}/`)) break;
      descendantChangeCountByPath.set(parent, (descendantChangeCountByPath.get(parent) ?? 0) + 1);
      if (parent === rootPath) break;
    }
  }

  return { changes, changeByPath, descendantChangeCountByPath };
}

export function emptyGitWorkspaceIndex(): GitWorkspaceIndex {
  return {
    changes: [],
    changeByPath: new Map(),
    descendantChangeCountByPath: new Map(),
  };
}

function parentPath(path: string) {
  if (path === "/") return null;
  const separator = path.lastIndexOf("/");
  return separator <= 0 ? "/" : path.slice(0, separator);
}

function normalize(path: string) {
  const normalized = path.replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
}
