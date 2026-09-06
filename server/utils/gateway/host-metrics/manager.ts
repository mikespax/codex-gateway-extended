import type {
  HostMetricsCollectorStatus,
  HostGpuProcessSnapshot,
  HostMetricsSample,
  HostMetricsSnapshot,
  HostRecord,
} from "~~/shared/types";
import type { SshConnectionPool } from "../infra/ssh/ssh-connection";
import { HostMetricsCollector } from "./collector";
import { HostMetricsEventBus } from "./events";

const MAX_SAMPLES = 300;

interface HostMetricsRuntime {
  collector: HostMetricsCollector;
  host: HostRecord;
  status: HostMetricsCollectorStatus;
  message: string | null;
  samples: HostMetricsSample[];
  gpuProcesses: HostGpuProcessSnapshot | null;
}

export class HostMetricsManager {
  readonly events = new HostMetricsEventBus();
  private runtimes = new Map<string, HostMetricsRuntime>();

  constructor(private readonly ssh: SshConnectionPool) {
    ssh.on("ready", ({ userId, host }) => this.ensureCollector(userId, host));
  }

  snapshot(userId: number, hostId: number): HostMetricsSnapshot {
    const runtime = this.runtimes.get(runtimeKey(userId, hostId));
    return {
      hostId,
      status: runtime?.status ?? "waiting",
      message: runtime?.message ?? null,
      samples: runtime?.samples.slice() ?? [],
      gpuProcesses: runtime?.gpuProcesses ?? null,
    };
  }

  removeHost(userId: number, hostId: number) {
    const key = runtimeKey(userId, hostId);
    this.runtimes.get(key)?.collector.stop();
    this.runtimes.delete(key);
  }

  /**
   * Ensure that a configured host has a collector and an SSH connection behind it.
   *
   * Collectors used to be created only as a side effect of some other host operation emitting
   * `ready`. That meant the host metrics endpoint could only report hosts the user had already
   * opened. The endpoint now calls this method for every configured host, so metrics are also
   * useful for hosts that have not been opened yet.
   */
  ensureCollector(userId: number, host: HostRecord) {
    const key = runtimeKey(userId, host.id);
    const existing = this.runtimes.get(key);
    if (existing !== undefined) {
      if (sameRemoteIdentity(existing.host, host)) existing.collector.start();
      else {
        this.removeHost(userId, host.id);
        this.ensureCollector(userId, host);
      }
      return;
    }

    const collector = new HostMetricsCollector(this.ssh, host, {
      sample: (sample, gpuProcesses) => this.acceptSample(userId, host.id, sample, gpuProcesses),
      disconnected: (message) => this.setStatus(userId, host.id, "disconnected", message),
      unsupported: (message) => this.setStatus(userId, host.id, "unsupported", message),
      error: (message) => this.setStatus(userId, host.id, "error", message),
    });
    const runtime: HostMetricsRuntime = {
      host,
      status: "waiting",
      message: null,
      samples: [],
      gpuProcesses: null,
      collector,
    };
    this.runtimes.set(key, runtime);
    // The ready event starts the collector in the normal path; this continuation also covers pool
    // implementations that do not emit ready themselves. Neither path creates a second SSH
    // connection because the pool coalesces equivalent connect() calls.
    void this.ssh
      .connect(host)
      .then(() => {
        if (this.runtimes.get(key) === runtime) runtime.collector.start();
      })
      .catch((error: unknown) => {
        if (this.runtimes.get(key) !== runtime) return;
        this.setStatus(
          userId,
          host.id,
          "error",
          error instanceof Error ? error.message : "Unable to connect to host for metrics",
        );
      });
  }

  private acceptSample(
    userId: number,
    hostId: number,
    sample: HostMetricsSample,
    gpuProcesses: HostGpuProcessSnapshot | null,
  ) {
    const runtime = this.runtimes.get(runtimeKey(userId, hostId));
    if (runtime === undefined) return;
    runtime.samples.push(sample);
    if (runtime.samples.length > MAX_SAMPLES)
      runtime.samples.splice(0, runtime.samples.length - MAX_SAMPLES);
    runtime.status = "collecting";
    runtime.message = null;
    if (gpuProcesses !== null) runtime.gpuProcesses = gpuProcesses;
    this.events.publish(userId, runtime.host.id, {
      type: "sample",
      hostId: runtime.host.id,
      sample,
      gpuProcesses,
    });
  }

  private setStatus(
    userId: number,
    hostId: number,
    status: HostMetricsCollectorStatus,
    message: string | null,
  ) {
    const runtime = this.runtimes.get(runtimeKey(userId, hostId));
    if (runtime === undefined) return;
    runtime.status = status;
    runtime.message = message;
    this.events.publish(userId, runtime.host.id, {
      type: "status",
      snapshot: this.snapshot(userId, runtime.host.id),
    });
  }
}

function runtimeKey(userId: number, hostId: number) {
  return `${userId}:${hostId}`;
}

function sameRemoteIdentity(left: HostRecord, right: HostRecord) {
  return (
    left.sshHost === right.sshHost && left.username === right.username && left.port === right.port
  );
}
