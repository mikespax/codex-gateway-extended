import type { TmuxSessionSnapshot, TmuxSessionsSnapshot } from "~~/shared/types";
import { AdaptivePollSchedule } from "../../infra/background/adaptive-poll-schedule";
import type { HostWithSecret } from "../../infra/ssh/ssh-types";
import { runWithGatewayUser } from "../../state/memory";

const SCAN_INTERVAL_MS = 15_000;
const MAX_SCAN_DELAY_MS = 60_000;
const SCAN_FAILURE_DELAYS_MS = [30_000, 60_000, 120_000] as const;

type SessionListener = (snapshot: TmuxSessionsSnapshot) => void;
type ScanSessions = (host: HostWithSecret) => Promise<TmuxSessionSnapshot[]>;

interface SessionRuntime {
  host: HostWithSecret;
  listeners: Set<SessionListener>;
  pending: Promise<TmuxSessionsSnapshot> | null;
  timer: ReturnType<typeof setTimeout> | null;
  signature: string | null;
  schedulePolicy: AdaptivePollSchedule;
}

export class TmuxSessionStreamManager {
  private readonly runtimes = new Map<string, SessionRuntime>();

  constructor(private readonly scanSessions: ScanSessions) {}

  subscribe(userId: number, host: HostWithSecret, listener: SessionListener) {
    const runtime = this.runtime(userId, host);
    runtime.listeners.add(listener);
    return () => {
      runtime.listeners.delete(listener);
      if (runtime.listeners.size === 0) this.dispose(userId, host.id, runtime);
    };
  }

  refresh(userId: number, host: HostWithSecret, forcePublish = false) {
    const runtime = this.runtime(userId, host);
    if (runtime.pending !== null) return runtime.pending;
    if (runtime.timer !== null) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
    const startedAt = Date.now();
    let nextDelayMs = SCAN_INTERVAL_MS;
    const pending = runWithGatewayUser(userId, () => this.scan(host))
      .then((snapshot) => {
        nextDelayMs =
          snapshot.error === null
            ? runtime.schedulePolicy.afterSuccess(Date.now() - startedAt)
            : runtime.schedulePolicy.afterFailure();
        const signature = JSON.stringify([snapshot.sessions, snapshot.error]);
        if (forcePublish || signature !== runtime.signature) {
          runtime.signature = signature;
          for (const listener of runtime.listeners) listener(snapshot);
        }
        return snapshot;
      })
      .finally(() => {
        if (runtime.pending === pending) runtime.pending = null;
        this.schedule(userId, runtime, nextDelayMs);
      });
    runtime.pending = pending;
    return pending;
  }

  removeHost(userId: number, hostId: number) {
    const key = runtimeKey(userId, hostId);
    const runtime = this.runtimes.get(key);
    if (runtime !== undefined) this.dispose(userId, hostId, runtime);
  }

  private runtime(userId: number, host: HostWithSecret) {
    const key = runtimeKey(userId, host.id);
    const existing = this.runtimes.get(key);
    if (existing !== undefined) {
      existing.host = host;
      return existing;
    }
    const runtime: SessionRuntime = {
      host,
      listeners: new Set(),
      pending: null,
      timer: null,
      signature: null,
      schedulePolicy: new AdaptivePollSchedule({
        minimumDelayMs: SCAN_INTERVAL_MS,
        maximumDelayMs: MAX_SCAN_DELAY_MS,
        failureDelaysMs: SCAN_FAILURE_DELAYS_MS,
      }),
    };
    this.runtimes.set(key, runtime);
    return runtime;
  }

  private async scan(host: HostWithSecret): Promise<TmuxSessionsSnapshot> {
    try {
      return {
        hostId: host.id,
        sessions: await this.scanSessions(host),
        error: null,
        scannedAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      return {
        hostId: host.id,
        sessions: [],
        error: error instanceof Error ? error.message : "Failed to scan remote tmux",
        scannedAt: new Date().toISOString(),
      };
    }
  }

  private schedule(userId: number, runtime: SessionRuntime, delayMs: number) {
    if (runtime.listeners.size === 0 || runtime.timer !== null) return;
    // Schedule after completion instead of setInterval. The shared cadence policy lengthens this
    // quiet period for slow or failing hosts, so tmux cannot accumulate exec channels behind Agent
    // RPC traffic. ssh2 has no per-channel QoS; bounded concurrency and less work are the reliable
    // isolation mechanisms, not an invented "priority" flag on the shared SSH connection.
    runtime.timer = setTimeout(() => {
      runtime.timer = null;
      void this.refresh(userId, runtime.host);
    }, delayMs);
  }

  private dispose(userId: number, hostId: number, runtime: SessionRuntime) {
    if (runtime.timer !== null) clearTimeout(runtime.timer);
    runtime.timer = null;
    runtime.listeners.clear();
    this.runtimes.delete(runtimeKey(userId, hostId));
  }
}

function runtimeKey(userId: number, hostId: number) {
  return `${userId}:${hostId}`;
}
