export type HostMetricsCollectorStatus =
  | "waiting"
  | "collecting"
  | "disconnected"
  | "unsupported"
  | "error";

export interface HostCpuMetrics {
  usagePercent: number | null;
  loadAverage: [number, number, number];
}

export interface HostMemoryMetrics {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface HostNetworkMetrics {
  receiveBytesPerSecond: number | null;
  transmitBytesPerSecond: number | null;
  interfaces: string[];
}

export interface HostFilesystemMetrics {
  device: string;
  filesystemType: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface HostDiskMetrics {
  readBytesPerSecond: number | null;
  writeBytesPerSecond: number | null;
  filesystems: HostFilesystemMetrics[];
}

export interface HostGpuMetrics {
  index: number;
  uuid: string;
  name: string;
  utilizationPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryUsagePercent: number;
  temperatureCelsius: number | null;
}

export interface HostGpuProcessDeviceUsage {
  gpuUuid: string;
  memoryUsedBytes: number;
}

export interface HostGpuProcess {
  pid: number;
  username: string | null;
  processName: string | null;
  command: string | null;
  elapsedSeconds: number | null;
  cpuPercent: number | null;
  hostMemoryBytes: number | null;
  devices: HostGpuProcessDeviceUsage[];
}

export interface HostGpuProcessSnapshot {
  sampledAt: string;
  processes: HostGpuProcess[];
}

export interface HostMetricsSample {
  sampledAt: string;
  cpu: HostCpuMetrics;
  memory: HostMemoryMetrics;
  network: HostNetworkMetrics;
  disk: HostDiskMetrics;
  gpus: HostGpuMetrics[];
}

export interface HostMetricsSnapshot {
  hostId: number;
  status: HostMetricsCollectorStatus;
  message: string | null;
  samples: HostMetricsSample[];
  gpuProcesses: HostGpuProcessSnapshot | null;
}

/** Compact, user-scoped host resource data used by the sidebar summary. */
export interface HostResourceUsageSummary {
  hostId: number;
  status: HostMetricsCollectorStatus;
  cpuPercent: number | null;
  memoryPercent: number | null;
  /** Root filesystem utilization, rounded to a whole percent when available. */
  diskPercent: number | null;
  sampledAt: string | null;
}
