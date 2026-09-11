import assert from "node:assert/strict";
import test from "node:test";
import {
  isThreadActiveStatus,
  runtimeStatusFromAppThreadStatus,
} from "../../shared/thread-runtime-status";

void test("intermediate app-server statuses retain running ownership", () => {
  for (const status of [
    "active",
    "inProgress",
    "running",
    "pending",
    "starting",
    "waitingForClient",
    "waitingForApproval",
  ]) {
    assert.equal(isThreadActiveStatus(status), true, status);
    assert.equal(runtimeStatusFromAppThreadStatus(status), "running", status);
  }
});

void test("terminal app-server statuses remain terminal", () => {
  assert.equal(runtimeStatusFromAppThreadStatus("completed"), "completed");
  assert.equal(runtimeStatusFromAppThreadStatus("idle"), "completed");
  assert.equal(runtimeStatusFromAppThreadStatus("failed"), "failed");
  assert.equal(runtimeStatusFromAppThreadStatus("interrupted"), "interrupted");
});
