import type { ComputedRef } from "vue";
import type { HostGpuMetrics, HostMetricsSample } from "~~/shared/types";
import type { HostMetricChartSeries } from "@/components/host-metrics/chart-types";

export function useHostMetricCharts(samples: ComputedRef<HostMetricsSample[]>) {
  const latest = computed(() => samples.value.at(-1) ?? null);
  const cpuSeries = computed(() => [
    series("CPU", "primary", samples.value, (sample) => sample.cpu.usagePercent),
  ]);
  const memorySeries = computed(() => [
    series("Memory", "primary", samples.value, (sample) => sample.memory.usagePercent),
  ]);
  const networkSeries = computed(() => [
    series("RX", "primary", samples.value, (sample) =>
      bytesToMebibytes(sample.network.receiveBytesPerSecond),
    ),
    series("TX", "secondary", samples.value, (sample) =>
      bytesToMebibytes(sample.network.transmitBytesPerSecond),
    ),
  ]);
  const diskSeries = computed(() => [
    series("Read", "primary", samples.value, (sample) =>
      bytesToMebibytes(sample.disk.readBytesPerSecond),
    ),
    series("Write", "secondary", samples.value, (sample) =>
      bytesToMebibytes(sample.disk.writeBytesPerSecond),
    ),
  ]);

  function gpuSeries(gpu: HostGpuMetrics) {
    return [
      series(
        `GPU ${gpu.index}`,
        "primary",
        samples.value,
        (sample) => gpuFor(sample, gpu.uuid)?.utilizationPercent ?? null,
      ),
      series(
        "VRAM",
        "secondary",
        samples.value,
        (sample) => gpuFor(sample, gpu.uuid)?.memoryUsagePercent ?? null,
      ),
      {
        ...series(
          "Temp",
          "danger",
          samples.value,
          (sample) => gpuFor(sample, gpu.uuid)?.temperatureCelsius ?? null,
        ),
        yAxisIndex: 1,
      },
    ] satisfies HostMetricChartSeries[];
  }

  return { latest, cpuSeries, memorySeries, networkSeries, diskSeries, gpuSeries };
}

function series(
  name: string,
  color: HostMetricChartSeries["color"],
  samples: HostMetricsSample[],
  value: (sample: HostMetricsSample) => number | null,
): HostMetricChartSeries {
  return { name, color, values: samples.map((sample) => [sample.sampledAt, value(sample)]) };
}

function bytesToMebibytes(value: number | null) {
  return value === null ? null : value / (1_024 * 1_024);
}

function gpuFor(sample: HostMetricsSample, uuid: string) {
  return sample.gpus.find((gpu) => gpu.uuid === uuid);
}
