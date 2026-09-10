import type { HostFilesystemMetrics } from "~~/shared/types";

type SidebarFilesystem = Pick<HostFilesystemMetrics, "mountPoint" | "usagePercent"> &
  Partial<Pick<HostFilesystemMetrics, "totalBytes">>;

export function rootFilesystemUsagePercent(filesystems: readonly SidebarFilesystem[]) {
  const root = filesystems.find((filesystem) => filesystem.mountPoint === "/");
  if (root !== undefined && Number.isFinite(root.usagePercent))
    return Math.round(root.usagePercent);

  // NAS appliances often expose `/` as a small tmpfs while the actual volume is mounted below
  // `/share` (QNAP) or another vendor-specific path. Fall back to the largest usable filesystem
  // instead of reporting the tiny runtime mount or leaving the sidebar blank.
  const largest = filesystems
    .filter(
      (filesystem) =>
        typeof filesystem.totalBytes === "number" &&
        Number.isFinite(filesystem.totalBytes) &&
        filesystem.totalBytes > 0 &&
        Number.isFinite(filesystem.usagePercent),
    )
    .reduce<SidebarFilesystem | null>(
      (current, filesystem) =>
        current === null || (filesystem.totalBytes ?? 0) > (current.totalBytes ?? 0)
          ? filesystem
          : current,
      null,
    );
  return largest === null ? null : Math.round(largest.usagePercent);
}
