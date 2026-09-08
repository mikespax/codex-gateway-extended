import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSidebarResourcePercent,
  parseSidebarResourceUsage,
  sidebarResourceTone,
} from "../../app/utils/sidebar-resource-usage";

void test("parses and rounds sidebar resource metrics independently", () => {
  assert.deepEqual(parseSidebarResourceUsage("CPU 59.6% · RAM 60.4% · HDD 80%"), [
    { key: "cpu", label: "CPU", percent: 59.6, display: "60%" },
    { key: "memory", label: "RAM", percent: 60.4, display: "60%" },
    { key: "disk", label: "HDD", percent: 80, display: "80%" },
  ]);
  assert.equal(formatSidebarResourcePercent(null), "—");
  assert.equal(formatSidebarResourcePercent(34.4), "34%");
});

void test("uses green, amber, and red high-water thresholds", () => {
  assert.equal(sidebarResourceTone(0), "green");
  assert.equal(sidebarResourceTone(59.9), "green");
  assert.equal(sidebarResourceTone(60), "amber");
  assert.equal(sidebarResourceTone(79.9), "amber");
  assert.equal(sidebarResourceTone(80), "red");
  assert.equal(sidebarResourceTone(null), "muted");
});

void test("returns no metrics for an unavailable or unrelated summary", () => {
  assert.deepEqual(parseSidebarResourceUsage(null), []);
  assert.deepEqual(parseSidebarResourceUsage("host.docker.internal"), []);
  assert.deepEqual(parseSidebarResourceUsage("CPU — · RAM — · HDD —"), [
    { key: "cpu", label: "CPU", percent: null, display: "—" },
    { key: "memory", label: "RAM", percent: null, display: "—" },
    { key: "disk", label: "HDD", percent: null, display: "—" },
  ]);
});
