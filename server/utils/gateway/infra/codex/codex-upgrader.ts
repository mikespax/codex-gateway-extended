import pRetry from "p-retry";
import { CodexArtifactProvider, type CodexArtifactBundle } from "./codex-artifacts";
import { parseCodexRemotePlatform } from "./codex-platform";
import {
  codexRemoteCleanupUpgradeStagePayload,
  codexRemoteCreateUpgradeStagePayload,
  codexRemoteOfflineInstallPayload,
  codexRemoteNodeRuntimeProbePayload,
  codexRemotePlatformProbePayload,
} from "./codex-upgrade-remote";
import { parseCodexVersion } from "./codex-version";
import { remoteLoginShellCommand } from "../ssh/remote-command";
import type { SshConnectionPool } from "../ssh/ssh-connection";
import type { CommandResult, HostWithSecret } from "../ssh/ssh-types";
import { codexUpgradeError, codexUpgradeLog } from "./codex-upgrade-log";

const UPGRADE_ATTEMPTS = 3;
const UPGRADE_IDLE_TIMEOUT_MS = 90_000;
const UPGRADE_TOTAL_TIMEOUT_MS = 10 * 60_000;
const artifactProvider = new CodexArtifactProvider();

interface UpgradeCommandResult extends CommandResult {
  closedBeforeExitStatus: boolean;
  exitSignal: string | null;
  exitDescription: string | null;
  exitCoreDumped: boolean | null;
}

export class CodexUpgrader {
  constructor(private readonly ssh: SshConnectionPool) {}

  async upgrade(host: HostWithSecret, version: string) {
    return await this.withPreparedUpgrade(host, version, (install) => install());
  }

  async withPreparedUpgrade<T>(
    host: HostWithSecret,
    version: string,
    callback: (install: () => Promise<string>) => Promise<T>,
  ) {
    const platformProbeStartedAt = Date.now();
    codexUpgradeLog("remote platform probe started", host, { targetVersion: version });
    const platform = await this.readRemotePlatform(host);
    codexUpgradeLog("remote platform probe completed", host, {
      targetVersion: version,
      platformPackage: platform.packageName,
      durationMs: Date.now() - platformProbeStartedAt,
    });
    const nodeProbeStartedAt = Date.now();
    codexUpgradeLog("remote Node.js probe started", host, { targetVersion: version });
    const includeNode = await this.requiresNodeBootstrap(host);
    codexUpgradeLog("remote Node.js probe completed", host, {
      targetVersion: version,
      bootstrapRequired: includeNode,
      durationMs: Date.now() - nodeProbeStartedAt,
    });
    const artifactStartedAt = Date.now();
    codexUpgradeLog("artifact preparation started", host, {
      targetVersion: version,
      platformPackage: platform.packageName,
      includeNode,
    });
    return await artifactProvider.withArtifacts(
      version,
      platform,
      { includeNode },
      async (artifacts) => {
        codexUpgradeLog("artifact preparation completed", host, {
          targetVersion: version,
          durationMs: Date.now() - artifactStartedAt,
          codexArchiveBytes: artifacts.cacheArchive.size,
          nodeArchiveBytes: artifacts.nodeArchive?.size ?? 0,
        });
        return await callback(() => this.installWithRetries(host, version, artifacts));
      },
    );
  }

  private async requiresNodeBootstrap(host: HostWithSecret) {
    const result = await this.ssh.exec(
      host,
      remoteLoginShellCommand(codexRemoteNodeRuntimeProbePayload()),
    );
    return result.code !== 0;
  }

  private async readRemotePlatform(host: HostWithSecret) {
    const result = await this.ssh.exec(
      host,
      remoteLoginShellCommand(codexRemotePlatformProbePayload()),
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "Failed to detect remote Codex platform");
    }
    return parseCodexRemotePlatform(result.stdout);
  }

  private async installWithRetries(
    host: HostWithSecret,
    version: string,
    artifacts: CodexArtifactBundle,
  ) {
    return await pRetry(
      (attemptNumber) => this.installOnce(host, version, artifacts, attemptNumber),
      {
        retries: UPGRADE_ATTEMPTS - 1,
        minTimeout: 1_000,
        factor: 2,
        shouldRetry: ({ error }) => isTransientUpgradeError(error),
        onFailedAttempt: ({ error, attemptNumber, retriesLeft }) => {
          codexUpgradeLog("installation retry scheduled", host, {
            attempt: attemptNumber,
            retriesLeft,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  }

  private async installOnce(
    host: HostWithSecret,
    version: string,
    artifacts: CodexArtifactBundle,
    attempt: number,
  ) {
    const attemptStartedAt = Date.now();
    codexUpgradeLog("installation attempt started", host, { targetVersion: version, attempt });
    const stagePath = await this.createRemoteStage(host);
    try {
      const nodeArtifact = artifacts.nodeArchive;
      if (nodeArtifact !== null) {
        await this.uploadArtifact(host, "node runtime", nodeArtifact.size, () =>
          this.ssh.uploadFileResumable(
            host,
            nodeArtifact.localPath,
            `${stagePath}/${nodeArtifact.fileName}`,
          ),
        );
      }
      await this.uploadArtifact(host, "Codex npm cache", artifacts.cacheArchive.size, () =>
        this.ssh.uploadFileResumable(
          host,
          artifacts.cacheArchive.localPath,
          `${stagePath}/${artifacts.cacheArchive.fileName}`,
        ),
      );
      const remoteInstallStartedAt = Date.now();
      codexUpgradeLog("remote npm install started", host, { targetVersion: version, attempt });
      const result = await this.execInstallCommand(
        host,
        remoteLoginShellCommand(
          codexRemoteOfflineInstallPayload({ version, stagePath, artifacts }),
        ),
      );
      if (result.code !== 0) throw new Error(upgradeFailureMessage(result));
      codexUpgradeLog("remote npm install completed", host, {
        targetVersion: version,
        attempt,
        durationMs: Date.now() - remoteInstallStartedAt,
      });
      const parsed = parseCodexVersion(result.stdout);
      if (!parsed) {
        throw new Error(`Unable to parse upgraded remote Codex version: ${result.stdout.trim()}`);
      }
      codexUpgradeLog("installation attempt completed", host, {
        targetVersion: version,
        installedVersion: parsed.version,
        attempt,
        durationMs: Date.now() - attemptStartedAt,
      });
      return parsed.version;
    } catch (error: unknown) {
      codexUpgradeError("installation attempt failed", host, error, {
        targetVersion: version,
        attempt,
        durationMs: Date.now() - attemptStartedAt,
      });
      throw error;
    } finally {
      await this.cleanupRemoteStage(host, stagePath);
    }
  }

  private async uploadArtifact(
    host: HostWithSecret,
    artifact: string,
    bytes: number,
    upload: () => Promise<string>,
  ) {
    const startedAt = Date.now();
    codexUpgradeLog("artifact upload started", host, { artifact, bytes });
    await upload();
    codexUpgradeLog("artifact upload completed", host, {
      artifact,
      bytes,
      durationMs: Date.now() - startedAt,
    });
  }

  private async createRemoteStage(host: HostWithSecret) {
    const result = await this.ssh.exec(
      host,
      remoteLoginShellCommand(codexRemoteCreateUpgradeStagePayload()),
    );
    const stagePath = result.stdout.trim();
    if (result.code !== 0 || !isSafeRemoteStagePath(stagePath)) {
      throw new Error(
        result.stderr || result.stdout || "Failed to create remote upgrade staging directory",
      );
    }
    return stagePath;
  }

  private async cleanupRemoteStage(host: HostWithSecret, stagePath: string) {
    try {
      await this.ssh.exec(
        host,
        remoteLoginShellCommand(codexRemoteCleanupUpgradeStagePayload(stagePath)),
      );
    } catch (error) {
      codexUpgradeError("remote staging cleanup failed", host, error);
    }
  }

  private async execInstallCommand(host: HostWithSecret, command: string) {
    const channel = await this.ssh.execChannel(host, command);

    return await new Promise<UpgradeCommandResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let exitStatusReceived = false;
      let exitCode: number | null = null;
      let exitSignal: string | null = null;
      let exitDescription: string | null = null;
      let exitCoreDumped: boolean | null = null;
      let idleTimer: NodeJS.Timeout | null = null;
      let totalTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (idleTimer !== null) clearTimeout(idleTimer);
        if (totalTimer !== null) clearTimeout(totalTimer);
      };
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const resetIdleTimer = () => {
        if (idleTimer !== null) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          this.ssh.disconnectHost(host);
          channel.close();
          settle(() =>
            reject(
              new Error(
                [
                  `Timed out installing remote Codex after ${Math.round(UPGRADE_IDLE_TIMEOUT_MS / 1000)}s without output`,
                  stderr.trim() ? `stderr tail:\n${tail(stderr, 2_000)}` : null,
                  stdout.trim() ? `stdout tail:\n${tail(stdout, 2_000)}` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              ),
            ),
          );
        }, UPGRADE_IDLE_TIMEOUT_MS);
      };

      resetIdleTimer();
      totalTimer = setTimeout(() => {
        this.ssh.disconnectHost(host);
        channel.close();
        settle(() => reject(new Error("Timed out installing remote Codex after 10m total")));
      }, UPGRADE_TOTAL_TIMEOUT_MS);

      channel.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        resetIdleTimer();
      });
      channel.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        resetIdleTimer();
      });
      channel.on("error", (error: Error) => settle(() => reject(error)));
      channel.on(
        "exit",
        (
          code: number | null,
          signal: string | null,
          coreDumped: boolean | null,
          description: string | null,
        ) => {
          exitStatusReceived = true;
          exitCode = code;
          exitSignal = signal;
          exitCoreDumped = coreDumped;
          exitDescription = description;
        },
      );
      channel.on("close", () => {
        settle(() =>
          resolve({
            code: exitStatusReceived ? exitCode : null,
            stdout,
            stderr,
            closedBeforeExitStatus: !exitStatusReceived,
            exitSignal,
            exitDescription,
            exitCoreDumped,
          }),
        );
      });
    });
  }
}

function isSafeRemoteStagePath(path: string) {
  return /^\/[A-Za-z0-9_./-]+\/\.cache\/codex-gateway\/upgrades\/upgrade\.[A-Za-z0-9]+$/.test(path);
}

function tail(value: string, maxLength: number) {
  return value.length <= maxLength ? value.trim() : value.slice(-maxLength).trim();
}

function upgradeFailureMessage(result: UpgradeCommandResult) {
  return [
    upgradeExitSummary(result),
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null,
    result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function upgradeExitSummary(result: UpgradeCommandResult) {
  if (result.closedBeforeExitStatus) {
    return "Failed to install remote Codex: SSH channel closed before remote exit status";
  }
  const signal = result.exitSignal !== null ? `, signal ${result.exitSignal}` : "";
  const coreDumped = result.exitCoreDumped === true ? ", core dumped" : "";
  const description =
    result.exitDescription !== null ? `, description: ${result.exitDescription}` : "";
  return `Failed to install remote Codex (exit ${result.code ?? "null"}${signal}${coreDumped}${description})`;
}

function isTransientUpgradeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /SSH channel closed before remote exit status|Timed out installing remote Codex|socket hang up|ECONNRESET|EPIPE|ETIMEDOUT|No response from server|Not connected|Connection lost/i.test(
    message,
  );
}
