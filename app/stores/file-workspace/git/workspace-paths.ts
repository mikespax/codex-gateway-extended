import type { RemoteGitWorkspaceFile, RemoteGitWorkspaceSnapshot } from "~~/shared/types";
import type { GitWorkspaceScopeInput } from "./workspace-types";

export function gitWorkspaceKey(input: GitWorkspaceScopeInput) {
  return `${input.hostId}:${input.projectId}:${normalize(input.rootPath)}`;
}

export function workspacePathForGitChange(
  input: GitWorkspaceScopeInput,
  snapshot: Extract<RemoteGitWorkspaceSnapshot, { availability: "available" }>,
  change: RemoteGitWorkspaceFile,
) {
  const relative = stripWorkspacePrefix(snapshot.workspaceRelativePath, change.relativePath);
  return relative === null ? null : joinAbsolute(input.rootPath, relative);
}

export function changeIsInWorkspace(
  snapshot: Extract<RemoteGitWorkspaceSnapshot, { availability: "available" }>,
  change: RemoteGitWorkspaceFile,
) {
  return stripWorkspacePrefix(snapshot.workspaceRelativePath, change.relativePath) !== null;
}

function stripWorkspacePrefix(prefix: string, path: string) {
  const normalizedPrefix = trimSlashes(prefix);
  const normalizedPath = trimSlashes(path);
  if (normalizedPrefix === "") return normalizedPath;
  if (normalizedPath === normalizedPrefix) return "";
  return normalizedPath.startsWith(`${normalizedPrefix}/`)
    ? normalizedPath.slice(normalizedPrefix.length + 1)
    : null;
}

function joinAbsolute(root: string, relative: string) {
  const normalizedRoot = normalize(root);
  return relative === ""
    ? normalizedRoot
    : `${normalizedRoot === "/" ? "" : normalizedRoot}/${relative}`;
}

function trimSlashes(path: string) {
  return path.replace(/^\/+|\/+$/g, "");
}

function normalize(path: string) {
  const normalized = path.replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
}
