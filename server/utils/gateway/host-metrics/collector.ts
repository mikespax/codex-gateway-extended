import type { ClientChannel } from "ssh2";
import type { HostGpuProcessSnapshot, HostRecord, HostMetricsSample } from "~~/shared/types";
import type { SshConnectionPool } from "../infra/ssh/ssh-connection";
import { AdaptivePollSchedule } from "../infra/background/adaptive-poll-schedule";
import { hostMetricsRemoteCommand } from "./remote-command";
import { HostMetricsRemoteParser } from "./remote-parser";
import { buildHostMetricsSample } from "./sample-builder";
import type { RawHostMetricsSample } from "./types";

const MIN_SAMPLE_DELAY_MS = 2_000;
const MAX_SAMPLE_DELAY_MS = 30_000;
const SAMPLE_TIMEOUT_MS = 45_000;
const GPU_PROCESS_SAMPLE_DELAY_MS = 10_000;
const FAILURE_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;

export interface HostMetricsCollectorCallbacks {
  sample: (sample: HostMetricsSample, gpuProcesses: HostGpuProcessSnapshot | null) => void;
  disconnected: (message: string | null) => void;
  unsupported: (message: string) => void;
  error: (message: string) => void;
}

type CollectionResult =
  | { kind: "sample"; raw: RawHostMetricsSample; elapsedMs: number }
  | { kind: "disconnected"; message: string | null }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

export class HostMetricsCollector {
  private channel: ClientChannel | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private previous: RawHostMetricsSample | null = null;
  private nextGpuProcessSampleAt = 0;
  private readonly schedulePolicy = new AdaptivePollSchedule({
    minimumDelayMs: MIN_SAMPLE_DELAY_MS,
    maximumDelayMs: MAX_SAMPLE_DELAY_MS,
    failureDelaysMs: FAILURE_DELAYS_MS,
  });

  constructor(
    private readonly ssh: SshConnectionPool,
    private readonly host: HostRecord,
    private readonly callbacks: HostMetricsCollectorCallbacks,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.collect();
  }

  stop() {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.channel?.close();
    this.channel = null;
  }

  private async collect() {
    if (!this.running || this.channel !== null) return;
    const result = await this.collectOnce().catch(
      (error: unknown): CollectionResult => ({
        kind: "error",
        message: error instanceof Error ? error.message : "Host metrics channel failed",
      }),
    );
    if (!this.running) return;

    switch (result.kind) {
      case "sample": {
        const sample = buildHostMetricsSample(result.raw, this.previous);
        this.previous = result.raw;
        const gpuProcesses = gpuProcessSnapshot(result.raw);
        if (gpuProcesses !== null) {
          this.nextGpuProcessSampleAt = Date.now() + GPU_PROCESS_SAMPLE_DELAY_MS;
        }
        this.callbacks.sample(sample, gpuProcesses);
        this.schedule(this.schedulePolicy.afterSuccess(result.elapsedMs));
        return;
      }
      case "unsupported":
        this.callbacks.unsupported("Host metrics require a Linux /proc filesystem");
        this.running = false;
        return;
      case "disconnected":
        this.callbacks.disconnected(result.message);
        break;
      case "error":
        this.callbacks.error(result.message);
        break;
    }
    this.schedule(this.schedulePolicy.afterFailure());
  }

  private async collectOnce(): Promise<CollectionResult> {
    const startedAt = Date.now();
    return await this.ssh.runBackground(this.host, async () => {
      if (!this.running) return { kind: "disconnected", message: null };
      return await this.collectChannelOnce(startedAt);
    });
  }

  private async collectChannelOnce(startedAt: number): Promise<CollectionResult> {
    const channel = await this.ssh.execChannelIfConnected(
      this.host,
      hostMetricsRemoteCommand(Date.now() >= this.nextGpuProcessSampleAt),
    );
    if (channel === null) return { kind: "disconnected", message: null };
    if (!this.running) {
      channel.close();
      return { kind: "disconnected", message: null };
    }
    this.channel = channel;
    return await new Promise<CollectionResult>((resolve) => {
      const parser = new HostMetricsRemoteParser();
      let raw: RawHostMetricsSample | null = null;
      let stderr = "";
      let unsupported = false;
      let errorMessage: string | null = null;
      let settled = false;
      const timeout = setTimeout(() => {
        errorMessage = `Host metrics sample timed out after ${SAMPLE_TIMEOUT_MS / 1_000}s`;
        channel.close();
      }, SAMPLE_TIMEOUT_MS);
      const finish = (result: CollectionResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.channel === channel) this.channel = null;
        resolve(result);
      };

      channel.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (text.includes("@@UNSUPPORTED")) {
          unsupported = true;
          return;
        }
        try {
          for (const parsed of parser.push(text)) raw = parsed;
        } catch (error: unknown) {
          errorMessage = error instanceof Error ? error.message : "Invalid host metrics data";
          channel.close();
        }
      });
      channel.stderr.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_096);
      });
      channel.on("error", (error: Error) => {
        errorMessage = error.message;
      });
      channel.on("close", () => {
        if (!this.running) {
          finish({ kind: "disconnected", message: null });
        } else if (unsupported) {
          finish({ kind: "unsupported" });
        } else if (errorMessage !== null) {
          finish({ kind: "error", message: errorMessage });
        } else if (raw !== null) {
          finish({ kind: "sample", raw, elapsedMs: Date.now() - startedAt });
        } else {
          finish({ kind: "disconnected", message: stderr.trim() || null });
        }
      });
    });
  }

  private schedule(delayMs: number) {
    if (!this.running || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.collect();
    }, delayMs);
  }
}

function gpuProcessSnapshot(raw: RawHostMetricsSample): HostGpuProcessSnapshot | null {
  return raw.gpuProcesses === null
    ? null
    : {
        sampledAt: new Date(raw.sampledAtMs).toISOString(),
        processes: raw.gpuProcesses,
      };
}
