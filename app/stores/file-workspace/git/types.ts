import type { RemoteGitFileComparison } from "~~/shared/types";

export interface FileGitComparisonState {
  key: string;
  loading: boolean;
  loaded: boolean;
  stale: boolean;
  error: string | null;
  comparison: RemoteGitFileComparison | null;
  baselineText: string | null;
}

export interface FileGitComparisonTarget {
  hostId: number;
  projectId: number;
  path: string;
}
