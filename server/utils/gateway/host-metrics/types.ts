import type {
  HostFilesystemMetrics,
  HostGpuMetrics,
  HostGpuProcess,
  HostMetricsSample,
} from "~~/shared/types";

export interface RawCpuCounters {
  total: number;
  idle: number;
  directUsagePercent: number | null;
}

export interface RawNetworkCounters {
  receiveBytes: number;
  transmitBytes: number;
  interfaces: string[];
}

export interface RawDiskCounters {
  readBytes: number;
  writeBytes: number;
}

export interface RawHostMetricsSample {
  sampledAtMs: number;
  cpu: RawCpuCounters;
  loadAverage: [number, number, number];
  memory: {
    totalBytes: number;
    availableBytes: number;
  };
  network: RawNetworkCounters;
  disk: RawDiskCounters;
  filesystems: HostFilesystemMetrics[];
  gpus: HostGpuMetrics[];
  gpuProcesses: HostGpuProcess[] | null;
}

export interface HostMetricsRateState {
  raw: RawHostMetricsSample;
  sample: HostMetricsSample;
}
