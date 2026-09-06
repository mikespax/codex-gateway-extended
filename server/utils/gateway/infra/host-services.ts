import { CodexRuntimeService } from "./codex/codex-runtime";
import { RemoteFileService } from "./files/remote-files";
import { SshConnectionPool } from "./ssh/ssh-connection";
import { HostMetricsManager } from "../host-metrics/manager";
import { RemoteGitFileService } from "./git/remote-git-files";
import { RemoteWorkspaceReadinessService } from "./git/remote-workspace-readiness";
import { ThreadStorageScanner } from "./codex/thread-storage";

export const sshConnections = new SshConnectionPool();
export const remoteFiles = new RemoteFileService(sshConnections);
export const remoteGitFiles = new RemoteGitFileService(sshConnections);
export const remoteWorkspaceReadiness = new RemoteWorkspaceReadinessService(sshConnections);
export const codexRuntime = new CodexRuntimeService(sshConnections);
export const hostMetricsManager = new HostMetricsManager(sshConnections);
export const threadStorage = new ThreadStorageScanner(sshConnections);
