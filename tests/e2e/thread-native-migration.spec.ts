import { randomUUID } from "node:crypto";
import { z } from "zod";
import { expect, test } from "./fixtures/remote-workspace";
import { authenticatedFetch, openApp } from "./helpers/app";
import {
  addRemoteHost,
  addRemoteProject,
  execRemoteSsh,
  readUpgradeRemoteEnvs,
  sendTextTurn,
  startRemoteThreadFromProjectMenu,
} from "./helpers/remote-codex";

const migrationResultSchema = z
  .object({
    mode: z.literal("native"),
    source: z.object({
      hostId: z.number().int().positive(),
      threadId: z.string().min(1),
      historyMode: z.enum(["legacy", "paginated"]),
      turnCount: z.number().int().positive(),
    }),
    target: z.object({
      hostId: z.number().int().positive(),
      threadId: z.string().min(1),
      rolloutPath: z.string().startsWith("/"),
      requestedCwd: z.string().startsWith("/"),
      historyMode: z.enum(["legacy", "paginated"]),
      turnCount: z.number().int().positive(),
    }),
    transfer: z.object({ files: z.number().int().positive(), bytes: z.number().int().positive() }),
    verification: z.object({
      sameThreadId: z.literal(true),
      sameRolloutRelativePath: z.literal(true),
      metadataParity: z.literal(true),
      historyParity: z.literal(true),
      descendantsVerified: z.literal(true),
      goalsVerified: z.literal(true),
      goalAccountingPreserved: z.boolean(),
      queuesVerified: z.literal(true),
    }),
    warnings: z.array(z.string()),
  })
  .loose();

const threadListSchema = z
  .object({ data: z.array(z.object({ id: z.string().min(1) }).loose()) })
  .loose();

test("migrates one real persisted Codex thread with the exact ID", async ({
  page,
  remoteWorkspace,
}) => {
  test.setTimeout(8 * 60_000);
  await openApp(page);
  const environments = await readUpgradeRemoteEnvs();
  const targetRemote = environments.find(
    (environment) =>
      environment.host !== remoteWorkspace.remote.host &&
      environment.runtimeFixture !== "empty-runtime",
  );
  test.skip(targetRemote === undefined, "The E2E environment has no isolated target Codex host");
  if (targetRemote === undefined) return;

  const suffix = randomUUID();
  const sourcePath = `/tmp/codex-native-source-${suffix}`;
  const targetPath = `/tmp/codex-native-target-${suffix}`;
  await execRemoteSsh(remoteWorkspace.remote, `mkdir -p -- ${shellQuote(sourcePath)}`);
  await execRemoteSsh(targetRemote, `mkdir -p -- ${shellQuote(targetPath)}`);
  const source = await remoteWorkspace.provision({
    hostName: `native-source-${suffix}`,
    remotePath: sourcePath,
  });
  let targetHost: { id: number } | undefined;
  try {
    targetHost = await addRemoteHost(page, targetRemote, `native-target-${suffix}`);
    await addRemoteProject(
      page,
      targetRemote,
      targetHost.id,
      `native-target-project-${suffix}`,
      targetPath,
    );
    const sourceThreadId = await startRemoteThreadFromProjectMenu(
      page,
      remoteWorkspace.remote,
      source.project.id,
    );
    const marker = `native migration e2e ${suffix}`;
    await sendTextTurn(page, marker, {
      hostId: source.host.id,
      threadId: sourceThreadId,
      cwd: sourcePath,
    });
    await expect(page.getByTestId("chat-scroll-area").getByText(marker)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
      "aria-label",
      /^(?:Completed|已完成)$/,
      { timeout: 120_000 },
    );

    const result = await authenticatedFetch(
      page,
      {
        url: "/api/threads/migrate",
        method: "POST",
        body: {
          sourceHostId: source.host.id,
          sourceThreadId,
          targetHostId: targetHost.id,
          targetCwd: targetPath,
        },
      },
      (value) => migrationResultSchema.parse(value),
    );
    expect(result.source.threadId).toBe(sourceThreadId);
    expect(result.target.threadId).toBe(sourceThreadId);
    expect(result.source.turnCount).toBe(result.target.turnCount);
    expect(result.source.historyMode).toBe(result.target.historyMode);
    expect(result.target.requestedCwd).toBe(targetPath);
    expect(result.verification.historyParity).toBe(true);

    const sourceListing = await authenticatedFetch(
      page,
      {
        url: `/api/threads?hostId=${source.host.id}&limit=100&searchTerm=${encodeURIComponent(sourceThreadId)}`,
      },
      (value) => threadListSchema.parse(value),
    );
    expect(sourceListing.data.some((thread) => thread.id === sourceThreadId)).toBe(true);

    // The migration result already verifies target thread/read, exact path, lineage, and full
    // history. The list endpoint returns a recency-limited first page before applying search, so
    // an old migrated thread is not guaranteed to appear in that page even when it is present.
  } finally {
    await execRemoteSsh(remoteWorkspace.remote, `rm -rf -- ${shellQuote(sourcePath)}`);
    await execRemoteSsh(targetRemote, `rm -rf -- ${shellQuote(targetPath)}`);
    if (targetHost !== undefined) {
      await authenticatedFetch(
        page,
        { url: `/api/hosts/${targetHost.id}`, method: "DELETE" },
        () => undefined,
      ).catch(() => undefined);
    }
  }
});

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
