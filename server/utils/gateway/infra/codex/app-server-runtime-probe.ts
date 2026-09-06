import { hostLifecycleBus } from "../../state/host-events";
import { parseCodexVersion } from "./codex-version";
import {
  codexRemoteAppServerRuntimeStatePayload,
  codexRemoteTerminateUnmanagedAppServerPayload,
  remoteLoginShellCommand,
} from "../ssh/remote-command";
import type { SshConnectionPool } from "../ssh/ssh-connection";
import type { HostWithSecret } from "../ssh/ssh-types";
import { appServerThreadFromUnknown } from "~~/shared/runtime/app-server";
import { parseLoadedThreadsPage } from "~~/shared/runtime/app-server";
import { recordFromUnknown } from "~~/shared/utils/records";
import { firstNonEmptyString } from "~~/shared/utils/strings";

export interface AppServerRuntimeState {
  running: boolean;
  appServerVersion: string | null;
  raw: string;
  versionError: string | null;
}

export class AppServerRuntimeProbe {
  constructor(private readonly ssh: SshConnectionPool) {}

  async readState(host: HostWithSecret): Promise<AppServerRuntimeState> {
    const result = await this.ssh.exec(
      host,
      remoteLoginShellCommand(codexRemoteAppServerRuntimeStatePayload()),
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    if (result.code === 0) {
      const parsed = parseAppServerRuntimeStateOutput(result.stdout);
      const running = parsed?.status === "running";
      const version = running ? await this.readRunningVersionResult(host) : null;
      return {
        running,
        appServerVersion: version?.version ?? null,
        raw: combined.trim(),
        versionError: version?.error ?? null,
      };
    }
    return {
      running: false,
      appServerVersion: null,
      raw: combined.trim(),
      versionError: null,
    };
  }

  async ensureStoppedAfterUpgrade(host: HostWithSecret) {
    const runtimeState = await this.readState(host);
    if (runtimeState.running) {
      await this.terminateUnmanaged(host);
    } else {
      this.ssh.disconnectHost(host);
    }
  }

  async terminateUnmanaged(host: HostWithSecret) {
    hostLifecycleBus.emit({
      hostId: host.id,
      status: "restarting",
      message: `正在停止 ${hostDisplayName(host)} 的旧远端 Codex app-server`,
    });
    const result = await this.ssh.exec(
      host,
      remoteLoginShellCommand(codexRemoteTerminateUnmanagedAppServerPayload()),
    );
    if (result.code !== 0) {
      throw new Error(
        firstNonEmptyString([result.stderr, result.stdout]) ??
          "Failed to terminate unmanaged remote Codex app-server",
      );
    }
    this.ssh.disconnectHost(host);
  }

  async readRunningVersion(host: HostWithSecret) {
    const result = await this.readRunningVersionResult(host);
    if (result.error !== null) {
      throw new Error(result.error);
    }
    return result.version;
  }

  private async readRunningVersionResult(host: HostWithSecret) {
    const { CodexRpcClient } = await import("../rpc/rpc");
    const client = new CodexRpcClient(host, {
      skipVersionCheck: true,
      requireExistingAppServer: true,
    });
    try {
      const userAgent = await client.probeRuntimeVersion();
      if (userAgent === null || userAgent === undefined || userAgent.length === 0) {
        return { version: null, error: null };
      }
      const parsed = parseCodexVersion(userAgent);
      if (parsed === null) {
        return {
          version: null,
          error: `Unable to parse remote app-server version: ${userAgent}`,
        };
      }
      return { version: parsed.version, error: null };
    } catch (error) {
      return {
        version: null,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.close();
    }
  }

  async hasActiveLoadedThread(host: HostWithSecret) {
    const { CodexRpcClient } = await import("../rpc/rpc");
    const client = new CodexRpcClient(host, {
      skipVersionCheck: true,
      requireExistingAppServer: true,
    });
    try {
      await client.connect();
      const loaded = await client.request("thread/loaded/list", {}, 30_000, parseLoadedThreadsPage);
      for (const threadId of loaded.data ?? []) {
        const read = await client.request("thread/read", { threadId, includeTurns: false }, 30_000);
        const record = recordFromUnknown(read);
        const thread = appServerThreadFromUnknown(record?.thread);
        if (isActiveThreadStatus(thread?.status ?? record?.status)) {
          return true;
        }
      }
      return false;
    } finally {
      client.close();
    }
  }
}

function isActiveThreadStatus(status: unknown) {
  const value = typeof status === "string" ? status : recordFromUnknown(status)?.type;
  return value === "active" || value === "inProgress" || value === "running";
}

function parseAppServerRuntimeStateOutput(
  output: string,
): { status?: string; backend?: string; appServerVersion?: string } | null {
  try {
    const parsed = recordFromUnknown(JSON.parse(output.trim()));
    if (parsed === null) return null;
    return {
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      backend: typeof parsed.backend === "string" ? parsed.backend : undefined,
      appServerVersion:
        typeof parsed.appServerVersion === "string" ? parsed.appServerVersion : undefined,
    };
  } catch {
    return null;
  }
}

function hostDisplayName(host: HostWithSecret) {
  return firstNonEmptyString([host.name, host.sshHost]) ?? "unknown host";
}
