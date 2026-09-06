import assert from "node:assert/strict";
import test from "node:test";
import { parseFilesystems } from "../../server/utils/gateway/host-metrics/remote-parser";

void test("filesystem parsing honors df capacity percentages", () => {
  const filesystems = parseFilesystems([
    "Filesystem Type 1024-blocks Used Available Capacity Mounted on",
    "/dev/disk1s1s1 apfs 3906682672 16299840 1253872240 2% /",
  ]);
  assert.equal(filesystems.length, 1);
  assert.equal(firstFilesystemUsagePercent(filesystems), 2);
});

void test("filesystem parsing falls back to calculated usage when capacity is invalid", () => {
  const filesystems = parseFilesystems([
    "Filesystem Type 1024-blocks Used Available Capacity Mounted on",
    "/dev/sda ext4 1000 125 875 - /",
  ]);
  assert.equal(filesystems.length, 1);
  assert.equal(firstFilesystemUsagePercent(filesystems), 12.5);
});

function firstFilesystemUsagePercent(value: unknown): number {
  assert.ok(Array.isArray(value));
  const filesystem: unknown = value.at(0);
  assert.ok(
    typeof filesystem === "object" &&
      filesystem !== null &&
      "usagePercent" in filesystem &&
      typeof filesystem.usagePercent === "number",
  );
  return filesystem.usagePercent;
}
