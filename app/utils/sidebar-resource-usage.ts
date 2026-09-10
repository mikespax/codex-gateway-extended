export type SidebarResourceMetricKey = "cpu" | "memory" | "disk";
export type SidebarResourceTone = "green" | "amber" | "red" | "muted";

export interface SidebarResourceMetric {
  key: SidebarResourceMetricKey;
  label: "CPU" | "RAM" | "HDD";
  percent: number | null;
  display: string;
}

/**
 * Resource utilization is deliberately conservative: amber asks for attention before a
 * resource is exhausted, while red represents a sustained high-water mark.
 */
export const SIDEBAR_RESOURCE_THRESHOLDS = {
  amber: 60,
  red: 80,
} as const;

export const sidebarResourceToneClass: Record<SidebarResourceTone, string> = {
  green: "text-accent-green",
  amber: "text-accent-orange-deep",
  red: "text-destructive",
  muted: "text-ink-faint",
};

const RESOURCE_FIELDS: ReadonlyArray<{
  key: SidebarResourceMetricKey;
  label: SidebarResourceMetric["label"];
}> = [
  { key: "cpu", label: "CPU" },
  { key: "memory", label: "RAM" },
  { key: "disk", label: "HDD" },
];

/** Parse the compact host summary without trusting display formatting for severity. */
export function parseSidebarResourceUsage(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return [] as SidebarResourceMetric[];
  }

  const metrics = RESOURCE_FIELDS.map(({ key, label }) => {
    const match = value.match(new RegExp(`\\b${label}\\s+([0-9]+(?:\\.[0-9]+)?)%`, "i"));
    const percent = match === null ? null : Number(match[1]);
    return {
      key,
      label,
      percent: percent !== null && Number.isFinite(percent) ? percent : null,
      display: formatSidebarResourcePercent(percent),
    } satisfies SidebarResourceMetric;
  });

  return metrics.some((metric) => value.toUpperCase().includes(metric.label)) ? metrics : [];
}

export function formatSidebarResourcePercent(percent: number | null | undefined) {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "—";
  return `${Math.round(percent)}%`;
}

export function sidebarResourceTone(percent: number | null | undefined): SidebarResourceTone {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "muted";
  if (percent >= SIDEBAR_RESOURCE_THRESHOLDS.red) return "red";
  if (percent >= SIDEBAR_RESOURCE_THRESHOLDS.amber) return "amber";
  return "green";
}

export function sidebarResourceToneForPercent(percent: number | null | undefined) {
  return sidebarResourceToneClass[sidebarResourceTone(percent)];
}
