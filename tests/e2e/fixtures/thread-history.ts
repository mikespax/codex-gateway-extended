import type { HostRecord, ProjectRecord, ThreadHistoryState } from "../../../shared/types";

export function defaultGatewayHost(hostId = 1): HostRecord {
  const now = new Date().toISOString();
  return {
    id: hostId,
    name: "E2E Host",
    sshHost: "localhost",
    username: "codex",
    port: 22,
    authMode: "password",
    privateKeyPath: null,
    privateKey: null,
    password: null,
    proxyUrl: null,
    hasPassword: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultGatewayProject(hostId = 1, projectId = 1): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: projectId,
    hostId,
    name: "E2E Project",
    remotePath: "/tmp/e2e",
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyThreadHistory(threadId: string): ThreadHistoryState {
  return { thread: { id: threadId, turns: [] } };
}
