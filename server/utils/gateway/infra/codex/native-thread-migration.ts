import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { posix } from "node:path";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type {
  AppServerThread,
  HostRecord,
  ThreadGoalStatus,
  ThreadNativeMigrationResult,
} from "~~/shared/types";
import {
  parseThreadReadResult,
  parseThreadResumeResult,
  parseThreadListPage,
  parseThreadGoalGetResponse,
  parseThreadGoalSetResponse,
  parseTurnsPage,
} from "~~/shared/runtime/app-server";
import type { RemoteFileService } from "../files/remote-files";
import { remoteLoginShellCommand } from "../ssh/remote-command";
import type { SshConnectionPool } from "../ssh/ssh-connection";
import { isCodexVersionAtLeast } from "./codex-version";
import { isMissingSftpPath } from "../files/remote-file-errors";

export const NATIVE_MIGRATION_MIN_CODEX_VERSION = "0.152.0";
// These ceilings cover the largest observed rollout/tree bundles while keeping staging bounded.
// Files are staged one at a time and the aggregate cap limits a single request's disk use.
export const NATIVE_MIGRATION_MAX_ROLLOUT_BYTES = 4 * 1024 * 1024 * 1024;
export const NATIVE_MIGRATION_MAX_TOTAL_BYTES = 32 * 1024 * 1024 * 1024;
export const NATIVE_MIGRATION_MAX_DESCENDANTS = 256;

type RpcClient = {
  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
    parse?: (value: unknown) => T,
  ): Promise<T>;
};

type ThreadBrokerLike = {
  getHostClient(host: HostRecord): Promise<RpcClient>;
  refreshThreadRuntimeStatus(
    host: HostRecord,
    threadId: string,
  ): Promise<{ status: string | null | undefined }>;
};

type RuntimeLike = {
  ensureCodexVersion(host: HostRecord): Promise<{
    version: string;
    appServerVersion: string | null;
  }>;
};

export interface NativeThreadMigrationDependencies {
  ssh: Pick<SshConnectionPool, "exec" | "uploadFileResumable">;
  remoteFiles: Pick<
    RemoteFileService,
    "openRemoteFile" | "statRemoteFile" | "inspectProjectDirectories"
  >;
  threadBroker: ThreadBrokerLike;
  codexRuntime: RuntimeLike;
  maxRolloutBytes?: number;
  maxTotalTransferBytes?: number;
  tempDirectory?: string;
}

export interface NativeThreadMigrationInput {
  sourceThreadId: string;
  sourceRolloutPath?: string;
  targetCwd: string;
}

interface CodexHomeInfo {
  home: string;
  codexHome: string;
}

interface RolloutInspection {
  id: string;
  parentThreadId: string | null;
  forkedFromId: string | null;
  historyMode: "legacy" | "paginated" | null;
  cwd: string | null;
  lineCount: number;
  attachmentPaths: string[];
  externalAttachmentReferenceCount: number;
  hasUnsupportedPersistedState: boolean;
}

interface MigrationThread {
  id: string;
  parentThreadId: string | null;
  forkedFromId: string | null;
  path: string;
  cwd: string;
  historyMode: "legacy" | "paginated";
  turnCount: number;
  targetPath?: string;
  bytes?: number;
  goal: ThreadGoalSnapshot | null;
  queue: QueueSubmission[];
}

interface ThreadGoalSnapshot {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
}

interface QueueSubmission {
  id: string;
  input: unknown[];
  clientUserMessageId: string;
}

const queueSubmissionSchema = z
  .object({
    id: z.string().min(1),
    input: z.array(z.unknown()),
    clientUserMessageId: z.string().min(1),
  })
  .loose();

export function parseNativeMigrationQueueListResponse(value: unknown): {
  data: QueueSubmission[];
  nextCursor?: string | null;
} {
  return z
    .object({
      data: z.array(queueSubmissionSchema),
      nextCursor: z.string().nullable().optional(),
    })
    .loose()
    .parse(value);
}

export function parseNativeMigrationQueueAddResponse(value: unknown): {
  queuedSubmission: QueueSubmission;
} {
  return z.object({ queuedSubmission: queueSubmissionSchema }).loose().parse(value);
}

export function nativeMigrationQueueMatches(source: QueueSubmission[], target: QueueSubmission[]) {
  return (
    source.length === target.length &&
    source.every(
      (submission, index) =>
        submission.clientUserMessageId === target[index]?.clientUserMessageId &&
        JSON.stringify(submission.input) === JSON.stringify(target[index]?.input),
    )
  );
}

export class NativeThreadMigrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "NativeThreadMigrationError";
  }
}

export class NativeThreadMigrationService {
  constructor(private readonly dependencies: NativeThreadMigrationDependencies) {}

  async migrate(
    sourceHost: HostRecord,
    targetHost: HostRecord,
    input: NativeThreadMigrationInput,
  ): Promise<ThreadNativeMigrationResult> {
    if (sourceHost.id === targetHost.id) {
      throw new NativeThreadMigrationError(
        "nativeMigrationSameHost",
        "Native thread migration requires different source and target hosts",
      );
    }
    const targetCwd = validateNativeMigrationPath(input.targetCwd, "Target working directory");
    const maxBytes = this.dependencies.maxRolloutBytes ?? NATIVE_MIGRATION_MAX_ROLLOUT_BYTES;
    const maxTotalBytes =
      this.dependencies.maxTotalTransferBytes ?? NATIVE_MIGRATION_MAX_TOTAL_BYTES;

    // Query both homes through the remote login shell. Never infer the target home from the
    // source path because the SSH accounts can have different homes or CODEX_HOME overrides.
    // Native migration preserves the relative Codex layout, so the absolute homes may differ
    // between hosts (for example, VPS /root/.codex and macOS /Users/Sparks/.codex).
    const [sourceHome, targetHome] = await Promise.all([
      this.readCodexHome(sourceHost),
      this.readCodexHome(targetHost),
    ]);
    const targetDirectory = await this.dependencies.remoteFiles.inspectProjectDirectories(
      targetHost,
      [targetCwd],
    );
    if (targetDirectory.get(targetCwd) !== "available") {
      throw new NativeThreadMigrationError(
        "nativeMigrationTargetCwdUnavailable",
        "Target working directory is unavailable",
      );
    }
    const sourceStatus = await this.dependencies.threadBroker.refreshThreadRuntimeStatus(
      sourceHost,
      input.sourceThreadId,
    );
    if (sourceStatus.status === "running") {
      throw new NativeThreadMigrationError(
        "nativeMigrationSourceRunning",
        "Stop the source thread before native migration",
        409,
      );
    }

    const [sourceClient, targetClient] = await Promise.all([
      this.dependencies.threadBroker.getHostClient(sourceHost),
      this.dependencies.threadBroker.getHostClient(targetHost),
    ]);
    await this.assertTargetVersion(targetHost);

    const sourceRead = await requestParsed(
      sourceClient,
      "thread/read",
      { threadId: input.sourceThreadId, includeTurns: false },
      parseThreadReadResult,
      "nativeMigrationSourceAppServerFailure",
    );
    if (sourceRead.thread.id !== input.sourceThreadId) {
      throw new NativeThreadMigrationError(
        "nativeMigrationSourceThreadMismatch",
        "Source app-server returned a different thread ID",
      );
    }
    const requestedSourcePath =
      input.sourceRolloutPath !== undefined
        ? validateNativeMigrationPath(input.sourceRolloutPath, "Source rollout path")
        : sourceRead.thread.path;
    if (requestedSourcePath === null || requestedSourcePath === undefined) {
      throw new NativeThreadMigrationError(
        "nativeMigrationSourceRolloutMissing",
        "Source thread did not provide a rollout path",
      );
    }
    const sourceRealPath = await this.resolveExistingRemotePath(sourceHost, requestedSourcePath);
    if (
      sourceRead.thread.path !== null &&
      posix.normalize(sourceRead.thread.path) !== sourceRealPath
    ) {
      throw new NativeThreadMigrationError(
        "nativeMigrationSourcePathMismatch",
        "Source app-server rollout path does not match the requested rollout",
      );
    }
    if (sourceRead.thread.parentThreadId !== null || sourceRead.thread.forkedFromId !== null) {
      throw new NativeThreadMigrationError(
        "nativeMigrationLineageUnsupported",
        "Native migration does not support a rollout with a parent or fork lineage",
      );
    }

    const sourceDescendants = await listDescendantThreads(sourceClient, input.sourceThreadId);
    if (sourceDescendants.length > NATIVE_MIGRATION_MAX_DESCENDANTS) {
      throw new NativeThreadMigrationError(
        "nativeMigrationTooManyDescendants",
        `Native migration supports at most ${NATIVE_MIGRATION_MAX_DESCENDANTS} descendants`,
      );
    }
    const rootTransferState = await readTransferState(sourceClient, input.sourceThreadId);
    const sourceThreads: MigrationThread[] = [
      {
        id: sourceRead.thread.id,
        parentThreadId: sourceRead.thread.parentThreadId,
        forkedFromId: sourceRead.thread.forkedFromId,
        path: sourceRealPath,
        cwd: sourceRead.thread.cwd,
        historyMode: sourceRead.thread.historyMode,
        turnCount: 0,
        goal: rootTransferState.goal,
        queue: rootTransferState.queue,
      },
    ];
    for (const listed of sourceDescendants) {
      const childRead = await requestParsed(
        sourceClient,
        "thread/read",
        { threadId: listed.id, includeTurns: false },
        parseThreadReadResult,
        "nativeMigrationSourceAppServerFailure",
      );
      if (childRead.thread.id !== listed.id) {
        throw new NativeThreadMigrationError(
          "nativeMigrationSourceThreadMismatch",
          "Source app-server returned a different descendant thread ID",
        );
      }
      const childPath = childRead.thread.path;
      if (childPath === null || !childPath.startsWith("/")) {
        throw new NativeThreadMigrationError(
          "nativeMigrationSourceRolloutMissing",
          "A descendant thread did not provide an absolute rollout path",
        );
      }
      const childStatus = await this.dependencies.threadBroker.refreshThreadRuntimeStatus(
        sourceHost,
        listed.id,
      );
      if (childStatus.status === "running") {
        throw new NativeThreadMigrationError(
          "nativeMigrationSourceRunning",
          "Stop all descendant threads before native migration",
          409,
        );
      }
      const childTransferState = await readTransferState(sourceClient, listed.id);
      if (childRead.thread.forkedFromId !== null && childRead.thread.parentThreadId === null) {
        throw new NativeThreadMigrationError(
          "nativeMigrationLineageUnsupported",
          "Native migration requires descendants to have a transferable parent thread edge",
        );
      }
      sourceThreads.push({
        id: childRead.thread.id,
        parentThreadId: childRead.thread.parentThreadId,
        forkedFromId: childRead.thread.forkedFromId,
        path: await this.resolveExistingRemotePath(sourceHost, childPath),
        cwd: childRead.thread.cwd,
        historyMode: childRead.thread.historyMode,
        turnCount: 0,
        goal: childTransferState.goal,
        queue: childTransferState.queue,
      });
    }
    assertParentBeforeChild(sourceThreads);
    for (const sourceThread of sourceThreads) {
      await this.assertTargetThreadDoesNotExist(targetClient, sourceThread.id);
    }
    let expectedTotalBytes = 0;
    for (const sourceThread of sourceThreads) {
      const sourceStats = await this.dependencies.remoteFiles.statRemoteFile(
        sourceHost,
        sourceThread.path,
        { maxSize: maxBytes },
      );
      expectedTotalBytes += sourceStats.size;
      if (expectedTotalBytes > maxTotalBytes) {
        throw new NativeThreadMigrationError(
          "nativeMigrationTransferTooLarge",
          "Native migration exceeds the aggregate transfer size limit",
        );
      }
    }
    const temporaryDirectory = await mkdtemp(
      posix.join(this.dependencies.tempDirectory ?? tmpdir(), "codex-native-migration-"),
    );
    const localRolloutPath = posix.join(temporaryDirectory, "rollout.jsonl");
    try {
      let totalBytes = 0;
      let attachmentBytes = 0;
      let attachmentFiles = 0;
      let goalAccountingPreserved = true;
      const warnings = new Set<string>();
      const transferredAttachments = new Set<string>();
      const targetThreads: MigrationThread[] = [];
      for (const sourceThread of sourceThreads) {
        const targetPath = nativeMigrationTargetRolloutPath(
          sourceThread.path,
          sourceHome.codexHome,
          targetHome.codexHome,
        );
        const sourceFile = await this.dependencies.remoteFiles.openRemoteFile(
          sourceHost,
          sourceThread.path,
          { maxSize: maxBytes },
        );
        if (totalBytes + sourceFile.size > maxTotalBytes) {
          throw new NativeThreadMigrationError(
            "nativeMigrationTransferTooLarge",
            "Native migration exceeds the aggregate transfer size limit",
          );
        }
        const sourceDigest = boundedBytesTransform(maxBytes);
        await pipeline(
          sourceFile.stream,
          sourceDigest.stream,
          createWriteStream(localRolloutPath, { mode: 0o600 }),
        );
        const localStats = await stat(localRolloutPath);
        if (localStats.size !== sourceFile.size) {
          throw new NativeThreadMigrationError(
            "nativeMigrationSourceChanged",
            "Source rollout changed while it was being staged",
          );
        }
        const inspection = await inspectRollout(localRolloutPath, sourceThread.id);
        if (inspection.hasUnsupportedPersistedState) {
          throw new NativeThreadMigrationError(
            "nativeMigrationPersistedStateUnsupported",
            "Native migration cannot prove that dynamic tools or artifact references are transferable",
          );
        }
        if (
          inspection.parentThreadId !== sourceThread.parentThreadId ||
          inspection.forkedFromId !== sourceThread.forkedFromId
        ) {
          throw new NativeThreadMigrationError(
            "nativeMigrationLineageUnsupported",
            "Rollout parent metadata does not match app-server lineage",
          );
        }
        if (
          inspection.historyMode !== null &&
          inspection.historyMode !== sourceThread.historyMode
        ) {
          throw new NativeThreadMigrationError(
            "nativeMigrationMetadataMismatch",
            "Source rollout history mode does not match app-server metadata",
          );
        }
        const sourceTurns = await listAllTurns(sourceClient, sourceThread.id);
        if (sourceTurns.length === 0) {
          throw new NativeThreadMigrationError(
            "nativeMigrationEmptyHistory",
            "Source rollout has no persisted turns",
          );
        }
        sourceThread.turnCount = sourceTurns.length;
        const attachmentResolution = await resolveAttachmentTransferPaths(
          this.dependencies.remoteFiles,
          sourceHost,
          inspection.attachmentPaths,
          sourceHome.codexHome,
          maxBytes,
        );
        if (attachmentResolution.missingExternalPathCount > 0) {
          warnings.add(
            "Some external attachment files were already missing and were retained without transfer.",
          );
        }
        if (inspection.externalAttachmentReferenceCount > 0) {
          warnings.add("External attachment references were retained without transfer.");
        }
        const pendingAttachmentSizes = new Map<string, number>();
        for (const sourceAttachmentPath of attachmentResolution.transferablePaths) {
          if (transferredAttachments.has(sourceAttachmentPath)) continue;
          const attachmentStats = await this.dependencies.remoteFiles.statRemoteFile(
            sourceHost,
            sourceAttachmentPath,
            { maxSize: maxBytes },
          );
          pendingAttachmentSizes.set(sourceAttachmentPath, attachmentStats.size);
        }
        const pendingBytes = [...pendingAttachmentSizes.values()].reduce(
          (sum, size) => sum + size,
          localStats.size,
        );
        if (totalBytes + pendingBytes > maxTotalBytes) {
          throw new NativeThreadMigrationError(
            "nativeMigrationTransferTooLarge",
            "Native migration exceeds the aggregate transfer size limit",
          );
        }
        await assertTargetFreeSpace(
          this.dependencies.ssh,
          targetHost,
          targetHome.codexHome,
          pendingBytes,
        );
        await assertTargetPathAvailable(
          this.dependencies.remoteFiles,
          targetHost,
          targetPath,
          maxBytes,
        );
        await ensureRemoteDirectory(this.dependencies.ssh, targetHost, posix.dirname(targetPath));
        await this.dependencies.ssh.uploadFileResumable(targetHost, localRolloutPath, targetPath);
        const targetFile = await this.dependencies.remoteFiles.statRemoteFile(
          targetHost,
          targetPath,
          { maxSize: maxBytes },
        );
        if (targetFile.size !== localStats.size) {
          throw new NativeThreadMigrationError(
            "nativeMigrationTransferIncomplete",
            "Target rollout size does not match the staged source",
          );
        }
        const targetDigest = await this.readRemoteSha256(targetHost, targetPath);
        if (targetDigest !== sourceDigest.digest()) {
          throw new NativeThreadMigrationError(
            "nativeMigrationTransferCorrupt",
            "Target rollout checksum does not match the staged source",
            502,
          );
        }
        totalBytes += localStats.size;
        for (const sourceAttachmentPath of attachmentResolution.transferablePaths) {
          if (transferredAttachments.has(sourceAttachmentPath)) continue;
          const relativeAttachmentPath = posix.relative(
            posix.join(sourceHome.codexHome, "attachments"),
            sourceAttachmentPath,
          );
          const targetAttachmentPath = posix.join(
            targetHome.codexHome,
            "attachments",
            relativeAttachmentPath,
          );
          const attachmentFile = await this.dependencies.remoteFiles.openRemoteFile(
            sourceHost,
            sourceAttachmentPath,
            { maxSize: maxBytes },
          );
          if (totalBytes + attachmentFile.size > maxTotalBytes) {
            throw new NativeThreadMigrationError(
              "nativeMigrationTransferTooLarge",
              "Native migration exceeds the aggregate transfer size limit",
            );
          }
          const localAttachmentPath = posix.join(
            temporaryDirectory,
            "attachments",
            relativeAttachmentPath,
          );
          await ensureLocalDirectory(posix.dirname(localAttachmentPath));
          const attachmentDigest = boundedBytesTransform(maxBytes);
          await pipeline(
            attachmentFile.stream,
            attachmentDigest.stream,
            createWriteStream(localAttachmentPath, { mode: 0o600 }),
          );
          const attachmentStats = await stat(localAttachmentPath);
          if (attachmentStats.size !== attachmentFile.size) {
            throw new NativeThreadMigrationError(
              "nativeMigrationSourceChanged",
              "Source attachment changed while it was being staged",
            );
          }
          const copied = await copyAttachment(
            this.dependencies,
            targetHost,
            targetAttachmentPath,
            localAttachmentPath,
            attachmentStats.size,
            attachmentDigest.digest(),
            maxBytes,
          );
          transferredAttachments.add(sourceAttachmentPath);
          if (copied) {
            attachmentFiles += 1;
            attachmentBytes += attachmentStats.size;
            totalBytes += attachmentStats.size;
          }
        }
        targetThreads.push({ ...sourceThread, targetPath, bytes: localStats.size });
      }

      for (const sourceThread of sourceThreads) {
        const targetPath = targetThreads.find(
          (thread) => thread.id === sourceThread.id,
        )?.targetPath;
        if (targetPath === undefined) throw new Error("Missing staged target rollout");
        const resumed = await requestParsed(
          targetClient,
          "thread/resume",
          { threadId: sourceThread.id, path: targetPath, cwd: targetCwd, excludeTurns: true },
          parseThreadResumeResult,
          "nativeMigrationTargetAppServerFailure",
        );
        if (resumed.thread.id !== sourceThread.id || resumed.thread.path !== targetPath) {
          throw new NativeThreadMigrationError(
            "nativeMigrationTargetMetadataMismatch",
            "Target app-server did not materialize the transferred thread with the same ID and path",
          );
        }
        goalAccountingPreserved =
          (await applyTargetTransferState(targetClient, sourceThread)) && goalAccountingPreserved;
      }
      const targetThreadsPage = await listDescendantThreads(
        targetClient,
        input.sourceThreadId,
        "nativeMigrationTargetAppServerFailure",
      );
      verifyTargetDescendants(targetThreadsPage, sourceThreads, targetThreads);
      const targetRootRead = await requestParsed(
        targetClient,
        "thread/read",
        { threadId: input.sourceThreadId, includeTurns: false },
        parseThreadReadResult,
        "nativeMigrationTargetAppServerFailure",
      );
      const targetRootTurns = await listAllTurns(targetClient, input.sourceThreadId);
      if (
        targetRootRead.thread.id !== input.sourceThreadId ||
        targetRootRead.thread.path !== targetThreads[0]?.targetPath ||
        targetRootRead.thread.historyMode !== sourceThreads[0]?.historyMode ||
        targetRootTurns.length !== sourceThreads[0]?.turnCount ||
        targetRootTurns.length === 0
      ) {
        throw new NativeThreadMigrationError(
          "nativeMigrationVerificationFailed",
          "Target app-server metadata or persisted history does not match the source rollout",
          502,
        );
      }
      await verifyTargetHistory(targetClient, sourceThreads.slice(1), targetThreads);

      if (!goalAccountingPreserved) {
        warnings.add(
          "Codex goal usage counters could not be restored exactly and started at zero on the target.",
        );
      }

      const rootSource = sourceThreads[0];
      const rootTarget = targetThreads[0];
      if (rootSource === undefined || rootTarget?.targetPath === undefined) {
        throw new NativeThreadMigrationError(
          "nativeMigrationVerificationFailed",
          "Target app-server omitted the migrated root thread",
          502,
        );
      }
      return {
        mode: "native",
        source: {
          hostId: sourceHost.id,
          threadId: input.sourceThreadId,
          rolloutPath: rootSource.path,
          historyMode: sourceRead.thread.historyMode,
          turnCount: rootSource.turnCount,
          queueCount: rootSource.queue.length,
        },
        target: {
          hostId: targetHost.id,
          threadId: targetRootRead.thread.id,
          rolloutPath: rootTarget.targetPath,
          cwd: targetRootRead.thread.cwd,
          requestedCwd: targetCwd,
          historyMode: targetRootRead.thread.historyMode,
          turnCount: rootSource.turnCount,
          queueCount: rootTarget.queue.length,
        },
        transfer: {
          files: sourceThreads.length + attachmentFiles,
          bytes: totalBytes,
          rollouts: { files: sourceThreads.length, bytes: totalBytes - attachmentBytes },
          attachments: { files: attachmentFiles, bytes: attachmentBytes },
        },
        verification: {
          sameThreadId: true,
          sameRolloutRelativePath: true,
          metadataParity: true,
          historyParity: true,
          descendantsVerified: true,
          goalsVerified: true,
          goalAccountingPreserved,
          queuesVerified: true,
        },
        warnings: [...warnings],
        descendants: sourceThreads.slice(1).map((sourceThread) => {
          const targetThread = targetThreads.find((thread) => thread.id === sourceThread.id)!;
          return {
            threadId: sourceThread.id,
            parentThreadId: sourceThread.parentThreadId,
            rolloutPath: sourceThread.path,
            targetRolloutPath: targetThread.targetPath!,
            turnCount: sourceThread.turnCount,
            queueCount: sourceThread.queue.length,
          };
        }),
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async readCodexHome(host: HostRecord): Promise<CodexHomeInfo> {
    const result = await this.dependencies.ssh.exec(
      host,
      remoteLoginShellCommand('printf "%s\\n%s\\n" "$HOME" "${CODEX_HOME:-$HOME/.codex}"'),
    );
    if (result.code !== 0) {
      throw new NativeThreadMigrationError(
        "nativeMigrationRemoteProbeFailed",
        "Unable to determine the remote Codex home",
        502,
      );
    }
    const lines = result.stdout.trim().split(/\r?\n/);
    const home = lines[0]?.trim() ?? "";
    const codexHome = lines[1]?.trim() ?? "";
    if (!home.startsWith("/") || !codexHome.startsWith("/")) {
      throw new NativeThreadMigrationError(
        "nativeMigrationInvalidCodexHome",
        "Remote Codex home is not absolute",
        502,
      );
    }
    return { home: posix.normalize(home), codexHome: posix.normalize(codexHome) };
  }

  private async resolveExistingRemotePath(host: HostRecord, path: string) {
    const payload = `set -eu
input=$1
realpath -e -- "$input"`;
    const result = await this.dependencies.ssh.exec(
      host,
      remoteLoginShellCommand(`sh -c ${shellQuote(payload)} sh ${shellQuote(path)}`),
    );
    if (result.code !== 0 || !result.stdout.trim().startsWith("/")) {
      throw new NativeThreadMigrationError(
        "nativeMigrationSourceRolloutMissing",
        "Source rollout does not exist or could not be resolved",
      );
    }
    return posix.normalize(result.stdout.trim());
  }

  private async assertTargetVersion(targetHost: HostRecord) {
    const versionState = await this.dependencies.codexRuntime.ensureCodexVersion(targetHost);
    const version = versionState.appServerVersion ?? versionState.version;
    if (!isCodexVersionAtLeast(version, NATIVE_MIGRATION_MIN_CODEX_VERSION)) {
      throw new NativeThreadMigrationError(
        "nativeMigrationTargetVersionUnsupported",
        `Target Codex app-server must be ${NATIVE_MIGRATION_MIN_CODEX_VERSION} or newer`,
        409,
      );
    }
  }

  private async readRemoteSha256(host: HostRecord, path: string) {
    const payload = `set -eu
input=$1
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -- "$input"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -- "$input"
else
  echo "No SHA-256 utility is available" >&2
  exit 127
fi`;
    const result = await this.dependencies.ssh.exec(
      host,
      remoteLoginShellCommand(`sh -c ${shellQuote(payload)} sh ${shellQuote(path)}`),
    );
    const digest = result.stdout.trim().split(/\s+/)[0] ?? "";
    if (result.code !== 0 || !/^[a-f0-9]{64}$/i.test(digest)) {
      throw new NativeThreadMigrationError(
        "nativeMigrationTransferVerificationUnavailable",
        "Unable to verify the target rollout checksum",
        502,
      );
    }
    return digest.toLowerCase();
  }

  private async assertTargetThreadDoesNotExist(client: RpcClient, threadId: string) {
    try {
      const read = await client.request(
        "thread/read",
        { threadId, includeTurns: false },
        10_000,
        parseThreadReadResult,
      );
      if (read.thread.id === threadId) {
        throw new NativeThreadMigrationError(
          "nativeMigrationTargetThreadExists",
          "Target host already contains this thread ID",
          409,
        );
      }
    } catch (error) {
      if (error instanceof NativeThreadMigrationError) throw error;
      if (!isMissingThreadError(error)) {
        throw new NativeThreadMigrationError(
          "nativeMigrationTargetAppServerFailure",
          "Target app-server could not verify that the thread ID is unused",
          502,
        );
      }
    }
  }
}

export function validateNativeMigrationPath(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("\0")) {
    throw new NativeThreadMigrationError("nativeMigrationInvalidPath", `${label} must be absolute`);
  }
  if (trimmed.split("/").includes("..")) {
    throw new NativeThreadMigrationError(
      "nativeMigrationUnsafePath",
      `${label} must not contain path traversal segments`,
    );
  }
  return posix.normalize(trimmed);
}

function relativeRolloutPath(sourcePath: string, codexHome: string) {
  const sessionsRoots = [
    posix.join(codexHome, "sessions"),
    posix.join(codexHome, "archived_sessions"),
  ];
  const normalized = posix.normalize(sourcePath);
  for (const root of sessionsRoots) {
    const relative = posix.relative(root, normalized);
    if (
      relative !== "" &&
      !relative.startsWith("../") &&
      relative !== ".." &&
      !posix.isAbsolute(relative)
    ) {
      return posix.join(posix.basename(root), relative);
    }
  }
  throw new NativeThreadMigrationError(
    "nativeMigrationSourcePathOutsideSessions",
    "Source rollout must be inside the remote Codex sessions or archived_sessions directory",
  );
}

export function nativeMigrationTargetRolloutPath(
  sourcePath: string,
  sourceCodexHome: string,
  targetCodexHome: string,
) {
  const sourceHome = validateNativeMigrationPath(sourceCodexHome, "Source CODEX_HOME");
  const targetHome = validateNativeMigrationPath(targetCodexHome, "Target CODEX_HOME");
  return posix.join(targetHome, relativeRolloutPath(sourcePath, sourceHome));
}

async function ensureRemoteDirectory(
  ssh: Pick<SshConnectionPool, "exec">,
  host: HostRecord,
  directory: string,
) {
  const result = await ssh.exec(
    host,
    remoteLoginShellCommand(`mkdir -p -- ${shellQuote(directory)}`),
  );
  if (result.code !== 0) {
    throw new NativeThreadMigrationError(
      "nativeMigrationTargetStorageFailed",
      "Unable to create the target Codex sessions directory",
      502,
    );
  }
}

async function assertTargetFreeSpace(
  ssh: Pick<SshConnectionPool, "exec">,
  host: HostRecord,
  directory: string,
  requiredBytes: number,
) {
  const result = await ssh.exec(
    host,
    remoteLoginShellCommand(`df -Pk -- ${shellQuote(directory)}`),
  );
  const availableBlocks = result.stdout.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/).at(3);
  const availableBytes = Number(availableBlocks) * 1024;
  if (
    result.code !== 0 ||
    !Number.isSafeInteger(availableBytes) ||
    availableBytes < requiredBytes
  ) {
    throw new NativeThreadMigrationError(
      "nativeMigrationTargetInsufficientSpace",
      "Target Codex home does not have enough free space for the bounded migration",
      409,
    );
  }
}

async function copyAttachment(
  dependencies: NativeThreadMigrationDependencies,
  targetHost: HostRecord,
  targetPath: string,
  localPath: string,
  expectedSize: number,
  expectedDigest: string,
  maxBytes: number,
) {
  let existing: Awaited<ReturnType<RemoteFileService["statRemoteFile"]>> | null = null;
  try {
    existing = await dependencies.remoteFiles.statRemoteFile(targetHost, targetPath, {
      maxSize: maxBytes,
    });
  } catch (error) {
    if (!isMissingSftpPath(error)) {
      throw new NativeThreadMigrationError(
        "nativeMigrationTargetStorageFailed",
        "Unable to verify a target attachment path",
        502,
      );
    }
  }
  if (existing !== null) {
    if (
      existing.size !== expectedSize ||
      (await readRemoteSha256(dependencies.ssh, targetHost, targetPath)) !== expectedDigest
    ) {
      throw new NativeThreadMigrationError(
        "nativeMigrationAttachmentConflict",
        "Target attachment exists with different content",
        409,
      );
    }
    return false;
  }
  await ensureRemoteDirectory(dependencies.ssh, targetHost, posix.dirname(targetPath));
  await assertTargetFreeSpace(
    dependencies.ssh,
    targetHost,
    posix.dirname(targetPath),
    expectedSize,
  );
  await dependencies.ssh.uploadFileResumable(targetHost, localPath, targetPath);
  const target = await dependencies.remoteFiles.statRemoteFile(targetHost, targetPath, {
    maxSize: maxBytes,
  });
  if (
    target.size !== expectedSize ||
    (await readRemoteSha256(dependencies.ssh, targetHost, targetPath)) !== expectedDigest
  ) {
    throw new NativeThreadMigrationError(
      "nativeMigrationTransferCorrupt",
      "Target attachment checksum does not match the staged source",
      502,
    );
  }
  return true;
}

async function readRemoteSha256(
  ssh: Pick<SshConnectionPool, "exec">,
  host: HostRecord,
  path: string,
) {
  const payload = `set -eu
input=$1
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -- "$input"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -- "$input"
else
  exit 127
fi`;
  const result = await ssh.exec(
    host,
    remoteLoginShellCommand(`sh -c ${shellQuote(payload)} sh ${shellQuote(path)}`),
  );
  const digest = result.stdout.trim().split(/\s+/)[0] ?? "";
  if (result.code !== 0 || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new NativeThreadMigrationError(
      "nativeMigrationTransferVerificationUnavailable",
      "Unable to verify a target file checksum",
      502,
    );
  }
  return digest.toLowerCase();
}

async function assertTargetPathAvailable(
  remoteFiles: Pick<RemoteFileService, "statRemoteFile">,
  targetHost: HostRecord,
  targetPath: string,
  maxBytes: number,
) {
  try {
    await remoteFiles.statRemoteFile(targetHost, targetPath, { maxSize: maxBytes });
    throw new NativeThreadMigrationError(
      "nativeMigrationTargetPathExists",
      "Target rollout path already exists",
      409,
    );
  } catch (error) {
    if (error instanceof NativeThreadMigrationError) throw error;
    if (!isMissingSftpPath(error)) {
      throw new NativeThreadMigrationError(
        "nativeMigrationTargetStorageFailed",
        "Unable to verify the target rollout path",
        502,
      );
    }
  }
}

function isMissingThreadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|unknown thread|thread does not exist|no such thread|thread not loaded/i.test(
    message,
  );
}

async function listDescendantThreads(
  client: RpcClient,
  ancestorThreadId: string,
  failureCode = "nativeMigrationSourceAppServerFailure",
) {
  const threads: AppServerThread[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  do {
    const page: ReturnType<typeof parseThreadListPage> = await requestParsed(
      client,
      "thread/list",
      { ancestorThreadId, cursor, limit: 100, sortDirection: "asc" },
      parseThreadListPage,
      failureCode,
    );
    threads.push(...page.data.filter((thread) => thread.id !== ancestorThreadId));
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) throw new Error("Codex thread/list returned a repeated cursor");
      seenCursors.add(cursor);
    }
  } while (cursor !== null);
  return threads;
}

async function readTransferState(client: RpcClient, threadId: string) {
  const goalResult = await requestParsed(
    client,
    "thread/goal/get",
    { threadId },
    parseThreadGoalGetResponse,
    "nativeMigrationSourceGoalUnsupported",
  );
  const goal = goalResult.goal;
  if (goal !== null && goal.threadId !== threadId) {
    throw new NativeThreadMigrationError(
      "nativeMigrationSourceGoalMismatch",
      "Source goal metadata does not match the thread ID",
    );
  }
  const normalizedGoal: ThreadGoalSnapshot | null =
    goal === null
      ? null
      : {
          threadId: goal.threadId,
          objective: goal.objective,
          status: goal.status,
          tokenBudget: goal.tokenBudget,
          tokensUsed: goal.tokensUsed,
          timeUsedSeconds: goal.timeUsedSeconds,
        };
  const queue = await listAllQueue(client, threadId, "nativeMigrationSourceQueueUnsupported");
  if (queue.some((submission) => hasNonTransferableQueueInput(submission.input))) {
    throw new NativeThreadMigrationError(
      "nativeMigrationQueueInputUnsupported",
      "Native migration cannot prove that queued external inputs are transferable",
    );
  }
  return { goal: normalizedGoal, queue };
}

async function applyTargetTransferState(client: RpcClient, sourceThread: MigrationThread) {
  if (sourceThread.goal !== null) {
    const setResult = await requestParsed(
      client,
      "thread/goal/set",
      {
        threadId: sourceThread.id,
        objective: sourceThread.goal.objective,
        status: sourceThread.goal.status,
        tokenBudget: sourceThread.goal.tokenBudget,
      },
      parseThreadGoalSetResponse,
      "nativeMigrationTargetGoalUnsupported",
    );
    if (!goalMetadataMatches(sourceThread.goal, setResult.goal)) {
      throw new NativeThreadMigrationError(
        "nativeMigrationTargetGoalMismatch",
        "Target app-server did not preserve the transferable goal fields",
        502,
      );
    }
  }
  const targetGoalResult = await requestParsed(
    client,
    "thread/goal/get",
    { threadId: sourceThread.id },
    parseThreadGoalGetResponse,
    "nativeMigrationTargetGoalUnsupported",
  );
  if (
    (sourceThread.goal === null && targetGoalResult.goal !== null) ||
    (sourceThread.goal !== null &&
      (targetGoalResult.goal === null ||
        !goalMetadataMatches(sourceThread.goal, targetGoalResult.goal)))
  ) {
    throw new NativeThreadMigrationError(
      "nativeMigrationTargetGoalMismatch",
      "Target app-server goal does not match the source transferable state",
      502,
    );
  }

  for (const submission of sourceThread.queue) {
    const added = await requestParsed(
      client,
      "thread/queue/add",
      {
        threadId: sourceThread.id,
        input: submission.input,
        clientUserMessageId: submission.clientUserMessageId,
      },
      parseNativeMigrationQueueAddResponse,
      "nativeMigrationTargetQueueUnsupported",
    );
    if (
      added.queuedSubmission.clientUserMessageId !== submission.clientUserMessageId ||
      JSON.stringify(added.queuedSubmission.input) !== JSON.stringify(submission.input)
    ) {
      throw new NativeThreadMigrationError(
        "nativeMigrationTargetQueueMismatch",
        "Target app-server did not preserve a queued submission",
        502,
      );
    }
  }
  const targetQueue = await listAllQueue(
    client,
    sourceThread.id,
    "nativeMigrationTargetQueueUnsupported",
  );
  if (!nativeMigrationQueueMatches(sourceThread.queue, targetQueue)) {
    throw new NativeThreadMigrationError(
      "nativeMigrationTargetQueueMismatch",
      "Target app-server queue order or content does not match the source",
      502,
    );
  }
  if (sourceThread.goal === null || targetGoalResult.goal === null)
    return sourceThread.goal === null;
  return (
    targetGoalResult.goal.tokensUsed === sourceThread.goal.tokensUsed &&
    targetGoalResult.goal.timeUsedSeconds === sourceThread.goal.timeUsedSeconds
  );
}

async function listAllQueue(client: RpcClient, threadId: string, failureCode: string) {
  const queue: QueueSubmission[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  do {
    const page: { data: QueueSubmission[]; nextCursor?: string | null } = await requestParsed(
      client,
      "thread/queue/list",
      { threadId, cursor, limit: 100 },
      parseNativeMigrationQueueListResponse,
      failureCode,
    );
    queue.push(...page.data);
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new NativeThreadMigrationError(
          failureCode,
          "Codex queue pagination returned a repeated cursor",
          502,
        );
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== null);
  return queue;
}

function goalMetadataMatches(
  source: ThreadGoalSnapshot,
  target: {
    threadId: string;
    objective: string;
    status: ThreadGoalStatus;
    tokenBudget: number | null;
    tokensUsed: number;
    timeUsedSeconds: number;
  },
) {
  return (
    target.threadId === source.threadId &&
    target.objective === source.objective &&
    target.status === source.status &&
    target.tokenBudget === source.tokenBudget
  );
}

function hasNonTransferableQueueInput(input: unknown[]): boolean {
  return input.some((item) => {
    if (!isRecord(item)) return true;
    const type = typeof item.type === "string" ? item.type : "";
    if (type !== "text" && /image|file|artifact|tool|computer/i.test(type)) return true;
    if ("path" in item || "url" in item || "image_url" in item) return true;
    return false;
  });
}

function assertParentBeforeChild(sourceThreads: MigrationThread[]) {
  const [root, ...pending] = sourceThreads;
  if (root === undefined)
    throw new NativeThreadMigrationError(
      "nativeMigrationInvalidRollout",
      "Source thread tree is empty",
    );
  const ordered = [root];
  while (pending.length > 0) {
    const index = pending.findIndex((thread) =>
      ordered.some((parent) => parent.id === (thread.parentThreadId ?? thread.forkedFromId)),
    );
    if (index < 0) {
      throw new NativeThreadMigrationError(
        "nativeMigrationUnsupportedDescendants",
        "Source descendant tree contains an edge whose parent is not transferable",
      );
    }
    ordered.push(pending.splice(index, 1)[0]!);
  }
  sourceThreads.splice(0, sourceThreads.length, ...ordered);
}

function verifyTargetDescendants(
  targetThreads: AppServerThread[],
  sourceThreads: MigrationThread[],
  targetRollouts: MigrationThread[],
) {
  const expected = sourceThreads.slice(1);
  const actual = new Map(targetThreads.map((thread) => [thread.id, thread]));
  for (const sourceThread of expected) {
    const target = actual.get(sourceThread.id);
    const expectedParent = sourceThread.parentThreadId ?? sourceThread.forkedFromId;
    if (
      target === undefined ||
      target.parentThreadId !== sourceThread.parentThreadId ||
      target.forkedFromId !== sourceThread.forkedFromId ||
      target.path !== targetRollouts.find((rollout) => rollout.id === sourceThread.id)?.targetPath
    ) {
      throw new NativeThreadMigrationError(
        "nativeMigrationDescendantVerificationFailed",
        "Target app-server descendant metadata or parent edge does not match the source",
        502,
      );
    }
    if (expectedParent === null) {
      throw new NativeThreadMigrationError(
        "nativeMigrationUnsupportedDescendants",
        "Source descendant is missing a parent edge",
      );
    }
  }
  if (actual.size !== expected.length) {
    throw new NativeThreadMigrationError(
      "nativeMigrationDescendantVerificationFailed",
      "Target app-server returned an unexpected descendant set",
      502,
    );
  }
}

async function verifyTargetHistory(
  client: RpcClient,
  sourceThreads: MigrationThread[],
  targetThreads: MigrationThread[],
) {
  for (const sourceThread of sourceThreads) {
    const target = targetThreads.find((thread) => thread.id === sourceThread.id);
    if (target?.targetPath === undefined) {
      throw new NativeThreadMigrationError(
        "nativeMigrationDescendantVerificationFailed",
        "Target app-server omitted a migrated descendant rollout",
        502,
      );
    }
    const read = await requestParsed(
      client,
      "thread/read",
      { threadId: sourceThread.id, includeTurns: false },
      parseThreadReadResult,
      "nativeMigrationTargetAppServerFailure",
    );
    const turns = await listAllTurns(client, sourceThread.id);
    if (
      read.thread.id !== sourceThread.id ||
      read.thread.path !== target.targetPath ||
      read.thread.historyMode !== sourceThread.historyMode ||
      turns.length !== sourceThread.turnCount ||
      turns.length === 0
    ) {
      throw new NativeThreadMigrationError(
        "nativeMigrationDescendantVerificationFailed",
        "Target app-server descendant history does not match the source rollout",
        502,
      );
    }
  }
}

export function hasNativeMigrationDescendants(
  threads: Array<{ id: string; parentThreadId: string | null; forkedFromId: string | null }>,
  rootId: string,
) {
  const children = new Map<string, string[]>();
  for (const thread of threads) {
    for (const parent of [thread.parentThreadId, thread.forkedFromId]) {
      if (parent === null) continue;
      const existing = children.get(parent) ?? [];
      existing.push(thread.id);
      children.set(parent, existing);
    }
  }
  const pending = [...(children.get(rootId) ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    if (current !== rootId) return true;
    pending.push(...(children.get(current) ?? []));
  }
  return false;
}

async function listAllTurns(client: RpcClient, threadId: string) {
  const turns = [] as unknown[];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  do {
    const page: ReturnType<typeof parseTurnsPage> = await requestParsed(
      client,
      "thread/turns/list",
      {
        threadId,
        cursor,
        limit: 100,
        sortDirection: "asc",
        itemsView: "summary",
      },
      parseTurnsPage,
      "nativeMigrationAppServerFailure",
    );
    turns.push(...page.data);
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (seenCursors.has(cursor))
        throw new Error("Codex thread/turns/list returned a repeated cursor");
      seenCursors.add(cursor);
    }
  } while (cursor !== null);
  return turns;
}

async function requestParsed<T>(
  client: RpcClient,
  method: string,
  params: unknown,
  parser: (value: unknown) => T,
  code: string,
) {
  try {
    return await client.request(method, params, 120_000, parser);
  } catch {
    throw new NativeThreadMigrationError(
      code,
      `${method} failed during native thread migration`,
      502,
    );
  }
}

async function inspectRollout(path: string, expectedId: string): Promise<RolloutInspection> {
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let metadata: Record<string, unknown> | null = null;
  const attachmentPaths = new Set<string>();
  const externalAttachmentReferences = new Set<string>();
  let hasUnsupportedPersistedState = false;
  let lineCount = 0;
  for await (const line of input) {
    if (line.trim() === "") continue;
    lineCount += 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new NativeThreadMigrationError(
        "nativeMigrationInvalidRollout",
        "Source rollout is not valid JSONL",
      );
    }
    if (!isRecord(value)) continue;
    if (value.type === "session_meta" && isRecord(value.payload) && metadata === null) {
      metadata = value.payload;
      if (value.payload.dynamic_tools !== null && value.payload.dynamic_tools !== undefined) {
        hasUnsupportedPersistedState = true;
      }
    }
    for (const reference of collectAttachmentReferences(value)) {
      const normalizedReference = normalizeNativeAttachmentReference(reference);
      const classification = classifyNativeMigrationAttachmentReference(normalizedReference);
      if (classification === "inline") continue;
      if (classification === "path") {
        attachmentPaths.add(normalizedReference);
      } else {
        externalAttachmentReferences.add(normalizedReference);
      }
    }
    if (isUnsupportedPersistedState(value)) hasUnsupportedPersistedState = true;
  }
  if (metadata === null) {
    throw new NativeThreadMigrationError(
      "nativeMigrationInvalidRollout",
      "Source rollout has no session metadata",
    );
  }
  const id = stringValue(metadata.id) ?? stringValue(metadata.session_id);
  if (id !== expectedId) {
    throw new NativeThreadMigrationError(
      "nativeMigrationSourceThreadMismatch",
      "Source rollout metadata does not match the requested thread ID",
    );
  }
  const historyMode =
    metadata.history_mode === "legacy" || metadata.history_mode === "paginated"
      ? metadata.history_mode
      : null;
  const cwd = stringValue(metadata.cwd);
  return {
    id,
    parentThreadId: stringValue(metadata.parent_thread_id),
    forkedFromId: stringValue(metadata.forked_from_id),
    historyMode,
    cwd,
    lineCount,
    attachmentPaths: [...attachmentPaths],
    externalAttachmentReferenceCount: externalAttachmentReferences.size,
    hasUnsupportedPersistedState,
  };
}

function normalizeNativeAttachmentReference(reference: string) {
  let normalized = reference.trim().replace(/[|,;.)\]}:]+$/g, "");
  normalized = normalized.replace(/:\d+(?::\d+)?$/g, "");
  return normalized;
}

async function resolveAttachmentTransferPaths(
  remoteFiles: Pick<RemoteFileService, "statRemoteFile">,
  sourceHost: HostRecord,
  attachmentPaths: string[],
  codexHome: string,
  maxBytes: number,
) {
  const transferablePaths: string[] = [];
  let missingExternalPathCount = 0;
  for (const attachmentPath of attachmentPaths) {
    const normalized = validateNativeMigrationPath(attachmentPath, "Attachment path");
    if (isInsideCodexAttachmentRoot(normalized, codexHome)) {
      transferablePaths.push(validateAttachmentPath(normalized, codexHome));
      continue;
    }
    try {
      await remoteFiles.statRemoteFile(sourceHost, normalized, { maxSize: maxBytes });
    } catch (error) {
      if (isMissingSftpPath(error)) {
        missingExternalPathCount += 1;
        continue;
      }
      throw new NativeThreadMigrationError(
        "nativeMigrationAttachmentsUnsupported",
        "Native migration could not verify an external attachment reference",
        502,
      );
    }
    throw new NativeThreadMigrationError(
      "nativeMigrationAttachmentsUnsupported",
      "Native migration found an external attachment file that cannot be transferred safely",
    );
  }
  return { transferablePaths, missingExternalPathCount };
}

export function classifyNativeMigrationAttachmentReference(reference: string) {
  if (reference.startsWith("data:")) return "inline" as const;
  if (reference.startsWith("/")) return "path" as const;
  return "external" as const;
}

function collectAttachmentReferences(value: unknown) {
  const references: string[] = [];
  const visit = (current: unknown, attachmentContext = false) => {
    if (typeof current === "string") {
      const embeddedPaths = current.match(/\/[^\s"'`<>()]+\/attachments\/[^\s"'`<>()]+/g);
      if (embeddedPaths !== null) references.push(...embeddedPaths);
      if (attachmentContext) references.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, attachmentContext);
      return;
    }
    if (!isRecord(current)) return;
    const type = typeof current.type === "string" ? current.type : "";
    const isAttachment = attachmentContext || /image|file|attachment/i.test(type);
    for (const [key, child] of Object.entries(current)) {
      const keyIsReference = /^(path|url|image_url|file_path|attachment_path)$/i.test(key);
      visit(child, isAttachment && keyIsReference);
    }
  };
  visit(value);
  return [...new Set(references)];
}

function validateAttachmentPath(path: string, codexHome: string) {
  const attachmentRoot = posix.join(codexHome, "attachments");
  const normalized = validateNativeMigrationPath(path, "Attachment path");
  const relative = posix.relative(attachmentRoot, normalized);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith("../") ||
    posix.isAbsolute(relative)
  ) {
    throw new NativeThreadMigrationError(
      "nativeMigrationAttachmentsUnsupported",
      "Referenced attachment is outside the source Codex attachments directory",
    );
  }
  return normalized;
}

function isInsideCodexAttachmentRoot(path: string, codexHome: string) {
  const attachmentRoot = posix.join(codexHome, "attachments");
  const relative = posix.relative(attachmentRoot, path);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !posix.isAbsolute(relative)
  );
}

async function ensureLocalDirectory(directory: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true, mode: 0o700 });
}

function isUnsupportedPersistedState(value: Record<string, unknown>) {
  const type = typeof value.type === "string" ? value.type : "";
  const payloadType =
    isRecord(value.payload) && typeof value.payload.type === "string" ? value.payload.type : "";
  return /artifact|dynamic.?tool/i.test(type) || /artifact|dynamic.?tool/i.test(payloadType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function boundedBytesTransform(maxBytes: number) {
  let bytes = 0;
  const hash = createHash("sha256");
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(
          new NativeThreadMigrationError(
            "nativeMigrationRolloutTooLarge",
            "Source rollout exceeds the maximum transfer size",
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { stream, digest: () => hash.digest("hex") };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
