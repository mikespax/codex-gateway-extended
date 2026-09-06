import type { HostMetricsSample } from "~~/shared/types";
import type { RawHostMetricsSample } from "./types";

export function buildHostMetricsSample(
  current: RawHostMetricsSample,
  previous: RawHostMetricsSample | null,
): HostMetricsSample {
  const elapsedSeconds =
    previous === null ? null : (current.sampledAtMs - previous.sampledAtMs) / 1_000;
  const memoryUsedBytes = Math.max(0, current.memory.totalBytes - current.memory.availableBytes);
  return {
    sampledAt: new Date(current.sampledAtMs).toISOString(),
    cpu: {
      usagePercent: current.cpu.directUsagePercent ?? cpuUsage(current, previous),
      loadAverage: current.loadAverage,
    },
    memory: {
      totalBytes: current.memory.totalBytes,
      usedBytes: memoryUsedBytes,
      availableBytes: current.memory.availableBytes,
      usagePercent:
        current.memory.totalBytes > 0 ? (memoryUsedBytes / current.memory.totalBytes) * 100 : 0,
    },
    network: {
      receiveBytesPerSecond: rate(
        current.network.receiveBytes,
        previous?.network.receiveBytes,
        elapsedSeconds,
      ),
      transmitBytesPerSecond: rate(
        current.network.transmitBytes,
        previous?.network.transmitBytes,
        elapsedSeconds,
      ),
      interfaces: current.network.interfaces,
    },
    disk: {
      readBytesPerSecond: rate(current.disk.readBytes, previous?.disk.readBytes, elapsedSeconds),
      writeBytesPerSecond: rate(current.disk.writeBytes, previous?.disk.writeBytes, elapsedSeconds),
      filesystems: current.filesystems,
    },
    gpus: current.gpus,
  };
}

function cpuUsage(current: RawHostMetricsSample, previous: RawHostMetricsSample | null) {
  if (previous === null) return null;
  const totalDelta = current.cpu.total - previous.cpu.total;
  const idleDelta = current.cpu.idle - previous.cpu.idle;
  if (totalDelta <= 0) return null;
  return clampPercent((1 - idleDelta / totalDelta) * 100);
}

function rate(current: number, previous: number | undefined, elapsedSeconds: number | null) {
  if (
    previous === undefined ||
    elapsedSeconds === null ||
    elapsedSeconds <= 0 ||
    current < previous
  )
    return null;
  return (current - previous) / elapsedSeconds;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}
