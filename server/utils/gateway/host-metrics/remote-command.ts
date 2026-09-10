import { shellQuote } from "../infra/ssh/shell";

export function hostMetricsRemoteCommand(includeGpuProcesses: boolean) {
  return `sh -lc ${shellQuote(script(includeGpuProcesses))}`;
}

function script(includeGpuProcesses: boolean) {
  return String.raw`
set -u
export LC_ALL=C
if [ "$(uname -s 2>/dev/null || printf unknown)" = "Darwin" ]; then
  if ! command -v sysctl >/dev/null 2>&1 || ! command -v vm_stat >/dev/null 2>&1 || ! command -v top >/dev/null 2>&1 || ! command -v awk >/dev/null 2>&1 || ! command -v tr >/dev/null 2>&1 || ! command -v df >/dev/null 2>&1; then
    printf '@@UNSUPPORTED\n'
    exit 0
  fi
  sampled_at_seconds="$(date +%s 2>/dev/null || true)"
  case "$sampled_at_seconds" in
    ''|*[!0-9]*) printf '@@UNSUPPORTED\n'; exit 0 ;;
  esac
  sampled_at="$sampled_at_seconds""000"
  cpu_percent="$(top -l 1 -n 0 2>/dev/null | awk -F'[:,%]' '/^CPU usage:/ { user = $2 + 0; kernel = $4 + 0; printf "%.2f", user + kernel; exit }')"
  load_average="$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' || true)"
  memory_total="$(sysctl -n hw.memsize 2>/dev/null || true)"
  vm_stat_output="$(vm_stat 2>/dev/null || true)"
  page_size="$(printf '%s\n' "$vm_stat_output" | awk '/page size of/ { gsub(/[^0-9]/, "", $8); print $8; exit }')"
  free_pages="$(printf '%s\n' "$vm_stat_output" | awk -F: '/^Pages free:/ { gsub(/[^0-9]/, "", $2); print $2; exit }')"
  inactive_pages="$(printf '%s\n' "$vm_stat_output" | awk -F: '/^Pages inactive:/ { gsub(/[^0-9]/, "", $2); print $2; exit }')"
  speculative_pages="$(printf '%s\n' "$vm_stat_output" | awk -F: '/^Pages speculative:/ { gsub(/[^0-9]/, "", $2); print $2; exit }')"
  if [ -z "$cpu_percent" ] || [ -z "$page_size" ] || [ -z "$free_pages" ] || [ -z "$inactive_pages" ] || [ -z "$memory_total" ]; then
    printf '@@UNSUPPORTED\n'
    exit 0
  fi
  if [ -z "$speculative_pages" ]; then speculative_pages=0; fi
  memory_available="$(awk -v total="$memory_total" -v page_size="$page_size" -v free="$free_pages" -v inactive="$inactive_pages" -v speculative="$speculative_pages" 'BEGIN { if (total !~ /^[0-9]+$/ || page_size !~ /^[0-9]+$/ || free !~ /^[0-9]+$/ || inactive !~ /^[0-9]+$/ || speculative !~ /^[0-9]+$/ || total <= 0 || page_size <= 0) exit 1; printf "%.0f %.0f", total / 1024, (free + inactive + speculative) * page_size / 1024 }')" || {
    printf '@@UNSUPPORTED\n'
    exit 0
  }
  memory_total_kib="$(printf '%s\n' "$memory_available" | awk '{ print $1 }')"
  memory_available_kib="$(printf '%s\n' "$memory_available" | awk '{ print $2 }')"
  printf '@@BEGIN\t%s\n' "$sampled_at"
  printf '@@CPU\n'
  printf 'cpu_percent %s\n' "$cpu_percent"
  printf '@@LOAD\n'
  printf '%s\n' "$load_average" | awk '{ print $1, $2, $3 }'
  printf '@@MEM\n'
  printf 'MemTotal: %s kB\n' "$memory_total_kib"
  printf 'MemAvailable: %s kB\n' "$memory_available_kib"
  printf '@@ROUTE\n'
  printf '@@NET\n'
  printf '@@BLOCK\n'
  printf '@@DISK\n'
  printf '@@FS\n'
  # macOS df does not expose a filesystem-type column, while the shared parser
  # intentionally accepts a normalized device/type/size shape. Keep the root
  # data filesystem here so sidebar HDD utilization reflects the APFS container,
  # not the nearly-empty sealed system volume.
  printf 'Filesystem Type 1024-blocks Used Available Capacity Mounted on\n'
  mac_data_mount="/System/Volumes/Data"
  [ -d "$mac_data_mount" ] || mac_data_mount="/"
  df -Pk "$mac_data_mount" 2>/dev/null | awk 'NR == 2 { print $1, "apfs", $2, $3, $4, $5, $6 }'
  printf '@@GPU\n'
${includeGpuProcesses ? gpuProcessScript() : ""}
  printf '@@END\n'
  exit 0
fi
if [ ! -r /proc/stat ] || [ ! -r /proc/meminfo ] || [ ! -r /proc/net/dev ] || [ ! -r /proc/diskstats ]; then
  printf '@@UNSUPPORTED\n'
  exit 0
fi
sampled_at_seconds="$(date +%s 2>/dev/null || true)"
case "$sampled_at_seconds" in
  ''|*[!0-9]*) printf '@@UNSUPPORTED\n'; exit 0 ;;
esac
sampled_at="$sampled_at_seconds""000"
printf '@@BEGIN\t%s\n' "$sampled_at"
printf '@@CPU\n'
sed -n '1p' /proc/stat
printf '@@LOAD\n'
sed -n '1p' /proc/loadavg
printf '@@MEM\n'
grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
printf '@@ROUTE\n'
cat /proc/net/route
printf '@@NET\n'
cat /proc/net/dev
printf '@@BLOCK\n'
for block in /sys/block/*; do [ -e "$block" ] && basename "$block"; done
printf '@@DISK\n'
cat /proc/diskstats
printf '@@FS\n'
df -PkT 2>/dev/null || true
printf '@@GPU\n'
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || true
fi
${includeGpuProcesses ? gpuProcessScript() : ""}
printf '@@END\n'
`;
}

function gpuProcessScript() {
  return String.raw`printf '@@GPU_PROCESS\n'
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_processes="$(nvidia-smi --query-compute-apps=gpu_uuid,pid,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null || true)"
  printf '%s\n' "$gpu_processes"
  printf '@@GPU_PROCESS_OS\n'
  pids="$(printf '%s\n' "$gpu_processes" | awk -F',' '{ gsub(/[[:space:]]/, "", $2); if ($2 ~ /^[0-9]+$/) print $2 }' | sort -nu | paste -sd, -)"
  if [ -n "$pids" ] && command -v ps >/dev/null 2>&1; then
    ps -ww -p "$pids" -o pid=,user:64=,etimes=,pcpu=,rss=,comm=,args= 2>/dev/null || true
  fi
else
  printf '@@GPU_PROCESS_OS\n'
fi
`;
}
