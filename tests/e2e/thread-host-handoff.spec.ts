import { randomUUID } from "node:crypto";
import { z } from "zod";
import { expect, test } from "./fixtures/remote-workspace";
import { authenticatedFetch, openApp } from "./helpers/app";
import { execRemoteSsh, startRemoteThreadFromProjectMenu } from "./helpers/remote-codex";
import { openThreadInStore } from "./helpers/gateway-store";

const threadMoveResultSchema = z
  .object({
    source: z.object({ hostId: z.number().int().positive(), threadId: z.string().min(1) }),
    target: z.object({
      hostId: z.number().int().positive(),
      projectId: z.number().int().positive(),
      threadId: z.string().min(1),
      title: z.string().min(1),
      cwd: z.string().min(1),
    }),
  })
  .strict();

const threadListSchema = z
  .object({
    data: z.array(z.object({ id: z.string().min(1) }).loose()),
  })
  .loose();

const threadMoveReadinessSchema = z
  .object({
    status: z.enum([
      "ready",
      "source_workspace_missing",
      "target_workspace_missing",
      "source_not_git",
      "target_not_git",
      "repository_mismatch",
      "source_commit_missing_on_target",
    ]),
    source: z.object({ hostId: z.number(), threadId: z.string(), cwd: z.string() }),
    target: z.object({ hostId: z.number(), cwd: z.string() }),
  })
  .strict();

test("prepares a missing target workspace from a clean source origin", async ({
  page,
  remoteWorkspace,
}) => {
  await openApp(page);

  const suffix = randomUUID();
  const rootPath = `/tmp/codex-gateway-prepare-${suffix}`;
  const originPath = `${rootPath}/origin.git`;
  const sourcePath = `${rootPath}/source`;
  const targetPath = `${rootPath}/target`;
  await execRemoteSsh(
    remoteWorkspace.remote,
    `
set -eu
mkdir -p -- ${shellQuote(rootPath)}
git init --bare -q ${shellQuote(originPath)}
git clone -q ${shellQuote(originPath)} ${shellQuote(sourcePath)}
git -C ${shellQuote(sourcePath)} config user.email codex-gateway-e2e@example.invalid
git -C ${shellQuote(sourcePath)} config user.name 'Codex Gateway E2E'
printf 'prepared workspace\\n' >${shellQuote(`${sourcePath}/README.md`)}
git -C ${shellQuote(sourcePath)} add README.md
git -C ${shellQuote(sourcePath)} commit -qm 'test: establish preparation baseline'
git -C ${shellQuote(sourcePath)} push -q origin HEAD
`,
  );

  try {
    const source = await remoteWorkspace.provision({
      hostName: `prepare-source-${suffix}`,
      remotePath: sourcePath,
    });
    const targetHost = await remoteWorkspace.addHost(`prepare-target-${suffix}`);
    const sourceThreadId = await startRemoteThreadFromProjectMenu(
      page,
      remoteWorkspace.remote,
      source.project.id,
    );

    const result = await authenticatedFetch(
      page,
      {
        url: "/api/threads/move/prepare-workspace",
        method: "POST",
        body: {
          sourceHostId: source.host.id,
          sourceThreadId,
          targetHostId: targetHost.id,
          targetCwd: targetPath,
        },
      },
      (value) => threadMoveReadinessSchema.parse(value),
    );
    expect(result.status).toBe("ready");
    expect(result.source.cwd).toBe(sourcePath);
    expect(result.target).toEqual({ hostId: targetHost.id, cwd: targetPath });

    const readiness = await authenticatedFetch(
      page,
      {
        url:
          `/api/threads/move/readiness?sourceHostId=${source.host.id}` +
          `&sourceThreadId=${encodeURIComponent(sourceThreadId)}` +
          `&targetHostId=${targetHost.id}` +
          `&targetCwd=${encodeURIComponent(targetPath)}`,
      },
      (value) => threadMoveReadinessSchema.parse(value),
    );
    expect(readiness.status).toBe("ready");

    await expect(
      authenticatedFetch(
        page,
        {
          url: "/api/threads/move/prepare-workspace",
          method: "POST",
          body: {
            sourceHostId: source.host.id,
            sourceThreadId,
            targetHostId: targetHost.id,
            targetCwd: targetPath,
          },
        },
        () => undefined,
      ),
    ).rejects.toThrow("already exists");
  } finally {
    await execRemoteSsh(remoteWorkspace.remote, `rm -rf -- ${shellQuote(rootPath)}`);
  }
});

test("reports a ready compatible Git workspace without exposing remote URLs", async ({
  page,
  remoteWorkspace,
}) => {
  await openApp(page);

  const suffix = randomUUID();
  const rootPath = `/tmp/codex-gateway-readiness-${suffix}`;
  const originPath = `${rootPath}/origin.git`;
  const sourcePath = `${rootPath}/source`;
  const targetPath = `${rootPath}/target`;
  await execRemoteSsh(
    remoteWorkspace.remote,
    `
set -eu
mkdir -p -- ${shellQuote(rootPath)}
git init --bare -q ${shellQuote(originPath)}
git clone -q ${shellQuote(originPath)} ${shellQuote(sourcePath)}
git -C ${shellQuote(sourcePath)} config user.email codex-gateway-e2e@example.invalid
git -C ${shellQuote(sourcePath)} config user.name 'Codex Gateway E2E'
printf 'readiness\\n' >${shellQuote(`${sourcePath}/README.md`)}
git -C ${shellQuote(sourcePath)} add README.md
git -C ${shellQuote(sourcePath)} commit -qm 'test: establish readiness baseline'
git -C ${shellQuote(sourcePath)} push -q origin HEAD
git clone -q ${shellQuote(originPath)} ${shellQuote(targetPath)}
`,
  );

  try {
    const source = await remoteWorkspace.provision({
      hostName: `readiness-source-${suffix}`,
      remotePath: sourcePath,
    });
    const target = await remoteWorkspace.provision({
      hostName: `readiness-target-${suffix}`,
      remotePath: targetPath,
    });
    const sourceThreadId = await startRemoteThreadFromProjectMenu(
      page,
      remoteWorkspace.remote,
      source.project.id,
    );

    const result = await authenticatedFetch(
      page,
      {
        url:
          `/api/threads/move/readiness?sourceHostId=${source.host.id}` +
          `&sourceThreadId=${encodeURIComponent(sourceThreadId)}` +
          `&targetHostId=${target.host.id}` +
          `&targetCwd=${encodeURIComponent(targetPath)}`,
      },
      (value) => threadMoveReadinessSchema.parse(value),
    );

    expect(result.status).toBe("ready");
    expect(result.source).toEqual({
      hostId: source.host.id,
      threadId: sourceThreadId,
      cwd: sourcePath,
    });
    expect(result.target).toEqual({ hostId: target.host.id, cwd: targetPath });
    expect(JSON.stringify(result)).not.toContain("origin.git");
  } finally {
    await execRemoteSsh(remoteWorkspace.remote, `rm -rf -- ${shellQuote(rootPath)}`);
  }
});

test("classifies non-Git and missing target workspaces before continuation", async ({
  page,
  remoteWorkspace,
}) => {
  await openApp(page);

  const suffix = randomUUID();
  const sourcePath = `/tmp/codex-gateway-readiness-source-${suffix}`;
  const targetPath = `/tmp/codex-gateway-readiness-target-${suffix}`;
  await execRemoteSsh(
    remoteWorkspace.remote,
    `mkdir -p -- ${shellQuote(sourcePath)} ${shellQuote(targetPath)}`,
  );
  try {
    const source = await remoteWorkspace.provision({
      hostName: `readiness-source-missing-${suffix}`,
      remotePath: sourcePath,
    });
    const target = await remoteWorkspace.provision({
      hostName: `readiness-target-missing-${suffix}`,
      remotePath: targetPath,
    });
    const sourceThreadId = await startRemoteThreadFromProjectMenu(
      page,
      remoteWorkspace.remote,
      source.project.id,
    );

    const sourceNotGit = await authenticatedFetch(
      page,
      {
        url:
          `/api/threads/move/readiness?sourceHostId=${source.host.id}` +
          `&sourceThreadId=${encodeURIComponent(sourceThreadId)}` +
          `&targetHostId=${target.host.id}` +
          `&targetCwd=${encodeURIComponent(targetPath)}`,
      },
      (value) => threadMoveReadinessSchema.parse(value),
    );
    expect(sourceNotGit.status).toBe("source_not_git");

    const missingTarget = await authenticatedFetch(
      page,
      {
        url:
          `/api/threads/move/readiness?sourceHostId=${source.host.id}` +
          `&sourceThreadId=${encodeURIComponent(sourceThreadId)}` +
          `&targetHostId=${target.host.id}` +
          `&targetCwd=${encodeURIComponent(`${targetPath}/gone`)}`,
      },
      (value) => threadMoveReadinessSchema.parse(value),
    );
    expect(missingTarget.status).toBe("target_workspace_missing");
  } finally {
    await execRemoteSsh(
      remoteWorkspace.remote,
      `rm -rf -- ${shellQuote(sourcePath)} ${shellQuote(targetPath)}`,
    );
  }
});

test("hands a thread off between isolated logical hosts without removing the source", async ({
  page,
  remoteWorkspace,
}) => {
  await openApp(page);

  const suffix = randomUUID();
  const sourcePath = `/tmp/codex-gateway-handoff-source-${suffix}`;
  const targetPath = `/tmp/codex-gateway-handoff-target-${suffix}`;
  await execRemoteSsh(
    remoteWorkspace.remote,
    `mkdir -p -- ${shellQuote(sourcePath)} ${shellQuote(targetPath)}`,
  );

  try {
    // These are two separately configured Gateway hosts pointing at the disposable E2E SSH
    // fixture. The distinct logical host IDs exercise the production cross-host boundary without
    // touching any user-configured VPS, Mac, or Lenovo host.
    const source = await remoteWorkspace.provision({
      hostName: `handoff-source-${suffix}`,
      remotePath: sourcePath,
    });
    const target = await remoteWorkspace.provision({
      hostName: `handoff-target-${suffix}`,
      remotePath: targetPath,
    });
    expect(source.host.id).not.toBe(target.host.id);

    const sourceThreadId = await startRemoteThreadFromProjectMenu(
      page,
      remoteWorkspace.remote,
      source.project.id,
    );
    const result = await authenticatedFetch(
      page,
      {
        url: "/api/threads/move",
        method: "POST",
        body: {
          sourceHostId: source.host.id,
          // The sidebar can retain a project ID from another host while its thread metadata is
          // refreshing. The server must safely derive the source cwd from the opened thread.
          sourceProjectId: target.project.id,
          sourceThreadId,
          targetHostId: target.host.id,
          targetProjectId: target.project.id,
        },
      },
      (value) => threadMoveResultSchema.parse(value),
    );

    expect(result.source).toEqual({ hostId: source.host.id, threadId: sourceThreadId });
    expect(result.target.hostId).toBe(target.host.id);
    expect(result.target.projectId).toBe(target.project.id);
    expect(result.target.threadId).not.toBe(sourceThreadId);
    expect(result.target.cwd).toBe(targetPath);

    // Opening both returned identities through the real realtime activation path proves the
    // target handoff was accepted and the original source remains usable.
    await openThreadInStore(page, {
      hostId: target.host.id,
      projectId: target.project.id,
      threadId: result.target.threadId,
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.__codexGatewayE2e?.navigation.selectedThreadId ?? null),
      )
      .toBe(result.target.threadId);

    const sourceListing = await authenticatedFetch(
      page,
      { url: `/api/threads?hostId=${source.host.id}&projectId=${source.project.id}&limit=100` },
      (value) => threadListSchema.parse(value),
    );
    expect(sourceListing.data.some((thread) => thread.id === sourceThreadId)).toBe(true);

    await openThreadInStore(page, {
      hostId: source.host.id,
      projectId: source.project.id,
      threadId: sourceThreadId,
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.__codexGatewayE2e?.navigation.selectedThreadId ?? null),
      )
      .toBe(sourceThreadId);
  } finally {
    await execRemoteSsh(
      remoteWorkspace.remote,
      `rm -rf -- ${shellQuote(sourcePath)} ${shellQuote(targetPath)}`,
    );
  }
});

test("rejects a target project that belongs to another host", async ({ page, remoteWorkspace }) => {
  await openApp(page);

  const suffix = randomUUID();
  const source = await remoteWorkspace.provision({
    hostName: `handoff-source-target-validation-${suffix}`,
  });
  const target = await remoteWorkspace.provision({
    hostName: `handoff-target-target-validation-${suffix}`,
  });

  await expect(
    authenticatedFetch(
      page,
      {
        url: "/api/threads/move",
        method: "POST",
        body: {
          sourceHostId: source.host.id,
          sourceProjectId: target.project.id,
          sourceThreadId: "unused-for-target-validation",
          targetHostId: target.host.id,
          targetProjectId: source.project.id,
        },
      },
      () => undefined,
    ),
  ).rejects.toThrow("Target project belongs to another host");
});

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
