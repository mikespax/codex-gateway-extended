const BYTES_PER_MEGABYTE = 1_024 * 1_024;
const BYTES_PER_GIGABYTE = 1_024 * BYTES_PER_MEGABYTE;

export type ThreadStorageTone = "green" | "amber" | "red" | "muted";

export function formatThreadSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < BYTES_PER_GIGABYTE) return `${Math.round(bytes / BYTES_PER_MEGABYTE)} MB`;
  return `${(bytes / BYTES_PER_GIGABYTE).toFixed(1)} GB`;
}

export function threadStorageTone(bytes: number | null | undefined): ThreadStorageTone {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "muted";
  if (bytes < BYTES_PER_GIGABYTE) return "green";
  if (bytes < 2 * BYTES_PER_GIGABYTE) return "amber";
  return "red";
}

export const threadStorageToneClass: Record<ThreadStorageTone, string> = {
  green: "text-accent-green",
  amber: "text-accent-orange-deep",
  red: "text-destructive",
  muted: "text-ink-faint",
};
