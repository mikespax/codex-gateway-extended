import type { RemoteGitWorkspaceFile } from "~~/shared/types";

export type GitChangeTreeNode = GitChangeDirectoryNode | GitChangeFileNode;

export interface GitChangeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: GitChangeTreeNode[];
}

export interface GitChangeFileNode {
  kind: "file";
  name: string;
  path: string;
  change: RemoteGitWorkspaceFile;
}

export function buildGitChangeTree(
  changes: RemoteGitWorkspaceFile[],
  pathForChange: (change: RemoteGitWorkspaceFile) => string | null,
  rootPath: string,
) {
  const root: GitChangeDirectoryNode = {
    kind: "directory",
    name: rootPath,
    path: rootPath,
    children: [],
  };
  for (const change of changes) {
    const absolutePath = pathForChange(change);
    if (absolutePath === null) continue;
    const relativePath = relativeToRoot(rootPath, absolutePath);
    if (relativePath === null || relativePath === "") continue;
    insert(root, relativePath.split("/"), absolutePath, change);
  }
  sortChildren(root);
  return root.children;
}

export function gitChangeDirectoryPaths(nodes: GitChangeTreeNode[]) {
  const paths: string[] = [];
  const visit = (node: GitChangeTreeNode) => {
    if (node.kind !== "directory") return;
    paths.push(node.path);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}

function insert(
  root: GitChangeDirectoryNode,
  parts: string[],
  absolutePath: string,
  change: RemoteGitWorkspaceFile,
) {
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    const existing = directory.children.find(
      (node): node is GitChangeDirectoryNode => node.kind === "directory" && node.name === part,
    );
    if (existing !== undefined) {
      directory = existing;
      continue;
    }
    const next: GitChangeDirectoryNode = {
      kind: "directory",
      name: part,
      path: `${directory.path.replace(/\/$/, "")}/${part}`,
      children: [],
    };
    directory.children.push(next);
    directory = next;
  }
  directory.children.push({
    kind: "file",
    name: parts.at(-1) ?? absolutePath,
    path: absolutePath,
    change,
  });
}

function sortChildren(directory: GitChangeDirectoryNode) {
  directory.children.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const child of directory.children) {
    if (child.kind === "directory") sortChildren(child);
  }
}

function relativeToRoot(rootPath: string, path: string) {
  const root = rootPath.replace(/\/+$/, "") || "/";
  if (root === "/") return path.replace(/^\/+/, "");
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}
