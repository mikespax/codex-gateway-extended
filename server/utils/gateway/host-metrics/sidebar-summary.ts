import type { HostFilesystemMetrics } from "~~/shared/types";

export function rootFilesystemUsagePercent(
  filesystems: readonly Pick<HostFilesystemMetrics, "mountPoint" | "usagePercent">[],
) {
  const root = filesystems.find((filesystem) => filesystem.mountPoint === "/");
  if (root === undefined || !Number.isFinite(root.usagePercent)) return null;
  return Math.round(root.usagePercent);
}
