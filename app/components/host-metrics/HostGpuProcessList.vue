<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  HostGpuMetrics,
  HostGpuProcess,
  HostGpuProcessDeviceUsage,
  HostGpuProcessSnapshot,
} from "~~/shared/types";
import IdentityBadge from "@/components/common/IdentityBadge.vue";
import { Badge } from "@codex-gateway/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@codex-gateway/ui/table";
import { formatBytes, formatMetricDuration, formatPercent } from "@/utils/host-metrics";

const props = defineProps<{
  snapshot: HostGpuProcessSnapshot | null;
  gpus: HostGpuMetrics[];
  currentUsername: string | null;
}>();

const ALL_USERS = "all";
const UNKNOWN_USER = "unknown";
const selectedUser = ref(ALL_USERS);
const { t } = useI18n();

const users = computed(() => {
  const names = new Set(
    (props.snapshot?.processes ?? [])
      .map((process) => process.username)
      .filter((username): username is string => username !== null),
  );
  return [...names].sort((left, right) => left.localeCompare(right));
});
const hasUnknownUser = computed(() =>
  (props.snapshot?.processes ?? []).some((process) => process.username === null),
);
const filteredProcesses = computed(() => {
  const processes = props.snapshot?.processes ?? [];
  if (selectedUser.value === ALL_USERS) return processes;
  if (selectedUser.value === UNKNOWN_USER) {
    return processes.filter((process) => process.username === null);
  }
  return processes.filter((process) => userFilterValue(process.username) === selectedUser.value);
});
const gpuByUuid = computed(() => new Map(props.gpus.map((gpu) => [gpu.uuid, gpu])));

watch([users, hasUnknownUser], () => {
  if (selectedUser.value === ALL_USERS) return;
  if (selectedUser.value === UNKNOWN_USER && hasUnknownUser.value) return;
  if (users.value.some((username) => userFilterValue(username) === selectedUser.value)) return;
  selectedUser.value = ALL_USERS;
});

function userFilterValue(username: string | null) {
  return username === null ? UNKNOWN_USER : `user:${username}`;
}

function userLabel(process: HostGpuProcess) {
  return process.username ?? t("app.gpuProcessUnknownUser");
}

function commandLabel(process: HostGpuProcess) {
  return process.command ?? process.processName ?? "-";
}

function gpuLabel(device: HostGpuProcessDeviceUsage) {
  const gpu = gpuByUuid.value.get(device.gpuUuid);
  return gpu ? `GPU ${gpu.index}` : device.gpuUuid.slice(0, 12);
}

function totalGpuMemory(process: HostGpuProcess) {
  return process.devices.reduce((total, device) => total + device.memoryUsedBytes, 0);
}
</script>

<template>
  <section
    class="min-w-0 overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm"
    data-testid="host-gpu-processes"
  >
    <header class="flex min-w-0 flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold text-ink">{{ $t("app.gpuProcesses") }}</h3>
        <p class="mt-0.5 text-xs text-ink-muted">
          <template v-if="snapshot">
            {{ $t("app.gpuProcessCount", { count: snapshot.processes.length }) }} ·
            {{ new Date(snapshot.sampledAt).toLocaleTimeString() }}
          </template>
          <template v-else>{{ $t("app.gpuProcessesWaiting") }}</template>
        </p>
      </div>
      <Select v-if="users.length + Number(hasUnknownUser) > 1" v-model="selectedUser">
        <SelectTrigger class="max-w-48 bg-surface" :aria-label="$t('app.gpuProcessUser')">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="ALL_USERS">{{ $t("app.gpuProcessAllUsers") }}</SelectItem>
          <SelectItem v-for="username in users" :key="username" :value="userFilterValue(username)">
            {{ username }}
          </SelectItem>
          <SelectItem v-if="hasUnknownUser" :value="UNKNOWN_USER">
            {{ $t("app.gpuProcessUnknownUser") }}
          </SelectItem>
        </SelectContent>
      </Select>
    </header>

    <div class="hidden md:block">
      <Table class="min-w-[64rem] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead class="w-36">{{ $t("app.gpuProcessUser") }}</TableHead>
            <TableHead class="w-24">{{ $t("app.gpuProcessPid") }}</TableHead>
            <TableHead class="w-44">{{ $t("app.gpuProcessGpu") }}</TableHead>
            <TableHead class="w-28">{{ $t("app.gpuProcessMemory") }}</TableHead>
            <TableHead class="w-28">{{ $t("app.gpuProcessElapsed") }}</TableHead>
            <TableHead class="w-24">{{ $t("app.gpuProcessCpu") }}</TableHead>
            <TableHead class="w-28">{{ $t("app.gpuProcessHostMemory") }}</TableHead>
            <TableHead>{{ $t("app.gpuProcessCommand") }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="process in filteredProcesses"
            :key="process.pid"
            :data-testid="`gpu-process-${process.pid}`"
          >
            <TableCell>
              <IdentityBadge
                :seed="process.username ?? UNKNOWN_USER"
                :label="userLabel(process)"
                :active="process.username === currentUsername"
              />
            </TableCell>
            <TableCell class="font-mono tabular-nums text-ink-muted">{{ process.pid }}</TableCell>
            <TableCell>
              <div class="flex flex-wrap gap-1">
                <Badge
                  v-for="device in process.devices"
                  :key="device.gpuUuid"
                  variant="outline"
                  class="font-mono"
                  :title="device.gpuUuid"
                >
                  {{ gpuLabel(device) }} · {{ formatBytes(device.memoryUsedBytes) }}
                </Badge>
              </div>
            </TableCell>
            <TableCell class="font-mono tabular-nums">
              {{ formatBytes(totalGpuMemory(process)) }}
            </TableCell>
            <TableCell class="font-mono tabular-nums text-ink-muted">
              {{ formatMetricDuration(process.elapsedSeconds) }}
            </TableCell>
            <TableCell class="font-mono tabular-nums text-ink-muted">
              {{ formatPercent(process.cpuPercent) }}
            </TableCell>
            <TableCell class="font-mono tabular-nums text-ink-muted">
              {{ process.hostMemoryBytes === null ? "-" : formatBytes(process.hostMemoryBytes) }}
            </TableCell>
            <TableCell class="min-w-0">
              <code
                class="block truncate font-mono text-xs text-ink-secondary"
                :title="commandLabel(process)"
              >
                {{ commandLabel(process) }}
              </code>
            </TableCell>
          </TableRow>
          <TableEmpty v-if="!snapshot" :colspan="8">
            {{ $t("app.gpuProcessesWaiting") }}
          </TableEmpty>
          <TableEmpty v-else-if="filteredProcesses.length === 0" :colspan="8">
            {{ $t("app.gpuProcessesEmpty") }}
          </TableEmpty>
        </TableBody>
      </Table>
    </div>

    <div class="divide-y divide-hairline md:hidden">
      <article
        v-for="process in filteredProcesses"
        :key="process.pid"
        class="space-y-2 p-3"
        :data-testid="`gpu-process-mobile-${process.pid}`"
      >
        <div class="flex min-w-0 items-center gap-2">
          <IdentityBadge
            :seed="process.username ?? UNKNOWN_USER"
            :label="userLabel(process)"
            :active="process.username === currentUsername"
          />
          <span class="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
            PID {{ process.pid }}
          </span>
          <span class="ml-auto shrink-0 font-mono text-xs text-ink">
            {{ formatBytes(totalGpuMemory(process)) }}
          </span>
        </div>
        <code class="line-clamp-2 break-all font-mono text-xs leading-relaxed text-ink-secondary">
          {{ commandLabel(process) }}
        </code>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <Badge
            v-for="device in process.devices"
            :key="device.gpuUuid"
            variant="outline"
            class="font-mono"
          >
            {{ gpuLabel(device) }} · {{ formatBytes(device.memoryUsedBytes) }}
          </Badge>
          <span>{{ formatMetricDuration(process.elapsedSeconds) }}</span>
          <span>CPU {{ formatPercent(process.cpuPercent) }}</span>
          <span>
            RAM
            {{ process.hostMemoryBytes === null ? "-" : formatBytes(process.hostMemoryBytes) }}
          </span>
        </div>
      </article>
      <p
        v-if="snapshot && filteredProcesses.length === 0"
        class="p-6 text-center text-sm text-ink-muted"
      >
        {{ $t("app.gpuProcessesEmpty") }}
      </p>
      <p v-else-if="!snapshot" class="p-6 text-center text-sm text-ink-muted">
        {{ $t("app.gpuProcessesWaiting") }}
      </p>
    </div>
  </section>
</template>
