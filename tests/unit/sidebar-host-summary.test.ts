import assert from "node:assert/strict";
import test from "node:test";
import { rootFilesystemUsagePercent } from "../../server/utils/gateway/host-metrics/sidebar-summary";

void test("sidebar host summary rounds root HDD utilization and handles missing roots", () => {
  assert.equal(
    rootFilesystemUsagePercent([
      { mountPoint: "/", usagePercent: 42.4 },
      { mountPoint: "/home", usagePercent: 98.9 },
    ]),
    42,
  );
  assert.equal(rootFilesystemUsagePercent([{ mountPoint: "/", usagePercent: 42.5 }]), 43);
  assert.equal(rootFilesystemUsagePercent([{ mountPoint: "/home", usagePercent: 88 }]), null);
  assert.equal(rootFilesystemUsagePercent([]), null);
});
