import { defineStore } from "pinia";
import type {
  HostGpuProcessSnapshot,
  HostMetricsCollectorStatus,
  HostMetricsSample,
  HostMetricsSnapshot,
} from "~~/shared/types";

const MAX_SAMPLES = 300;

interface HostMetricsViewState {
  status: HostMetricsCollectorStatus;
  message: string | null;
  samples: HostMetricsSample[];
  gpuProcesses: HostGpuProcessSnapshot | null;
}

export const useGatewayHostMetricsDataStore = defineStore("gateway-host-metrics-data", () => {
  const hosts = ref<Record<number, HostMetricsViewState>>({});

  function applySnapshot(snapshot: HostMetricsSnapshot) {
    hosts.value = {
      ...hosts.value,
      [snapshot.hostId]: {
        status: snapshot.status,
        message: snapshot.message,
        samples: snapshot.samples.slice(-MAX_SAMPLES),
        gpuProcesses: snapshot.gpuProcesses,
      },
    };
  }

  function appendSample(
    hostId: number,
    sample: HostMetricsSample,
    gpuProcesses: HostGpuProcessSnapshot | null,
  ) {
    const current = hosts.value[hostId] ?? emptyHostState();
    const samples = [...current.samples, sample].slice(-MAX_SAMPLES);
    hosts.value = {
      ...hosts.value,
      [hostId]: {
        status: "collecting",
        message: null,
        samples,
        gpuProcesses: gpuProcesses ?? current.gpuProcesses,
      },
    };
  }

  function setStatus(hostId: number, status: HostMetricsCollectorStatus, message: string | null) {
    const current = hosts.value[hostId] ?? emptyHostState();
    hosts.value = { ...hosts.value, [hostId]: { ...current, status, message } };
  }

  function clearHost(hostId: number) {
    const next = { ...hosts.value };
    delete next[hostId];
    hosts.value = next;
  }

  function reset() {
    hosts.value = {};
  }

  return { hosts, applySnapshot, appendSample, setStatus, clearHost, reset };
});

function emptyHostState(): HostMetricsViewState {
  return { status: "waiting", message: null, samples: [], gpuProcesses: null };
}
