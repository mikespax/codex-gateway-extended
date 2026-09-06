export function formatBytes(value: number) {
  return formatBinaryUnit(value, "B");
}

export function formatByteRate(value: number | null) {
  return value === null ? "-" : `${formatBinaryUnit(value, "B")}/s`;
}

export function formatPercent(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

export function formatMetricDuration(seconds: number | null) {
  if (seconds === null) return "-";
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(wholeSeconds / 86_400);
  const hours = Math.floor((wholeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBinaryUnit(value: number, baseUnit: string) {
  const units = [baseUnit, `Ki${baseUnit}`, `Mi${baseUnit}`, `Gi${baseUnit}`, `Ti${baseUnit}`];
  let scaled = Math.max(0, value);
  let unitIndex = 0;
  while (scaled >= 1_024 && unitIndex < units.length - 1) {
    scaled /= 1_024;
    unitIndex += 1;
  }
  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
