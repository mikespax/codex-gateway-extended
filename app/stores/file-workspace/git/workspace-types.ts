import type { RemoteGitWorkspaceFile, RemoteGitWorkspaceSnapshot } from "~~/shared/types";

export interface GitWorkspaceScopeInput {
  hostId: number;
  projectId: number;
  rootPath: string;
}

export interface FileGitWorkspaceState extends GitWorkspaceScopeInput {
  key: string;
  loading: boolean;
  loaded: boolean;
  stale: boolean;
  error: string | null;
  snapshot: RemoteGitWorkspaceSnapshot | null;
  changes: RemoteGitWorkspaceFile[];
  changeByPath: ReadonlyMap<string, RemoteGitWorkspaceFile>;
  descendantChangeCountByPath: ReadonlyMap<string, number>;
}
