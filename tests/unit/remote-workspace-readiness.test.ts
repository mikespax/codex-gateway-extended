import assert from "node:assert/strict";
import test from "node:test";
import {
  isVpsGenericWorkspacePath,
  RemoteWorkspaceReadinessService,
  type RemoteWorkspaceReadiness,
} from "../../server/utils/gateway/infra/git/remote-workspace-readiness";
import type { HostRecord } from "../../shared/types";

const notGit: RemoteWorkspaceReadiness = {
  availability: "notGit",
  repositoryRoot: null,
  repositoryIdentity: null,
  headCommit: null,
  clean: false,
  originConfigured: false,
};

const operationsWorkspace: RemoteWorkspaceReadiness = {
  availability: "available",
  repositoryRoot: "/root/stickerlight-ops",
  repositoryIdentity: "operations-origin-fingerprint",
  headCommit: "0123456789abcdef0123456789abcdef01234567",
  clean: true,
  originConfigured: true,
};

const vpsHost = {
  id: 1,
  name: "VPS",
  sshHost: "vps.example.invalid",
  username: "codex",
  port: 22,
  authMode: "agent",
  privateKeyPath: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies HostRecord;

function serviceWithReadiness(readinessByPath: Record<string, RemoteWorkspaceReadiness>) {
  const service = new RemoteWorkspaceReadinessService({
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
  service.inspect = async (_host: HostRecord, path: string) => {
    const readiness = readinessByPath[path];
    if (readiness === undefined) throw new Error(`Unexpected readiness path: ${path}`);
    return readiness;
  };
  return service;
}

void test("VPS generic matching includes exact paths and nested ephemeral workspaces", () => {
  for (const path of [
    "/",
    "/root",
    "/root/.aws",
    "/root/.cache",
    "/root/.codex",
    "/root/.config",
    "/tmp",
    "/var/tmp",
    "/tmp/coder-implementation-recall.9KsBde",
    "/var/tmp/build/session",
  ]) {
    assert.equal(isVpsGenericWorkspacePath(path), true, path);
  }
});

void test("VPS generic matching respects path boundaries", () => {
  for (const path of ["/tmp-workspace", "/var/tmp2", "/www/tmp/project", "/rooted"]) {
    assert.equal(isVpsGenericWorkspacePath(path), false, path);
  }
});

void test("nested ephemeral source workspaces use the verified VPS operations fallback", async () => {
  const sourceCwd = "/var/tmp/coder-implementation-recall.9KsBde";
  const service = serviceWithReadiness({
    [sourceCwd]: notGit,
    "/root/stickerlight-ops": operationsWorkspace,
  });

  const resolved = await service.resolveSourceWorkspace(vpsHost, sourceCwd);

  assert.deepEqual(resolved, {
    readiness: operationsWorkspace,
    kind: "operations_fallback",
    cwd: "/root/stickerlight-ops",
  });
});

void test("non-VPS and non-generic source paths retain the thread workspace", async () => {
  const ephemeralCwd = "/tmp/coder-implementation-recall.9KsBde";
  const applicationCwd = "/www/stickerlight-app";
  const service = serviceWithReadiness({
    [ephemeralCwd]: notGit,
    [applicationCwd]: notGit,
  });

  const nonVps = await service.resolveSourceWorkspace({ ...vpsHost, name: "mac" }, ephemeralCwd);
  const nonGeneric = await service.resolveSourceWorkspace(vpsHost, applicationCwd);

  assert.deepEqual(nonVps, { readiness: notGit, kind: "thread_cwd", cwd: ephemeralCwd });
  assert.deepEqual(nonGeneric, { readiness: notGit, kind: "thread_cwd", cwd: applicationCwd });
});
