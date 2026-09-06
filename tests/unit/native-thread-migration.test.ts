import assert from "node:assert/strict";
import test from "node:test";
import {
  hasNativeMigrationDescendants,
  classifyNativeMigrationAttachmentReference,
  NativeThreadMigrationError,
  nativeMigrationQueueMatches,
  nativeMigrationTargetRolloutPath,
  parseNativeMigrationQueueAddResponse,
  parseNativeMigrationQueueListResponse,
  validateNativeMigrationPath,
} from "../../server/utils/gateway/infra/codex/native-thread-migration";
import {
  buildTurnStartParams,
  GATEWAY_APPROVAL_POLICY,
} from "../../server/utils/gateway/protocol/thread-payload";

void test("native migration rejects traversal and non-absolute paths", () => {
  assert.equal(
    validateNativeMigrationPath("/home/codex/.codex/sessions/a.jsonl", "rollout"),
    "/home/codex/.codex/sessions/a.jsonl",
  );
  assert.throws(
    () => validateNativeMigrationPath("relative/session.jsonl", "rollout"),
    (error: unknown) =>
      error instanceof NativeThreadMigrationError && error.code === "nativeMigrationInvalidPath",
  );
  assert.throws(
    () => validateNativeMigrationPath("/home/codex/.codex/sessions/../x", "rollout"),
    (error: unknown) =>
      error instanceof NativeThreadMigrationError && error.code === "nativeMigrationUnsafePath",
  );
});

void test("native migration detects recursive descendant thread edges", () => {
  assert.equal(
    hasNativeMigrationDescendants(
      [
        { id: "child", parentThreadId: "root", forkedFromId: null },
        { id: "grandchild", parentThreadId: "child", forkedFromId: null },
      ],
      "root",
    ),
    true,
  );
  assert.equal(
    hasNativeMigrationDescendants(
      [{ id: "other", parentThreadId: "unrelated", forkedFromId: null }],
      "root",
    ),
    false,
  );
});

void test("native migration maps rollout paths across different Codex homes", () => {
  assert.equal(
    nativeMigrationTargetRolloutPath(
      "/root/.codex/sessions/2026/09/03/thread.jsonl",
      "/root/.codex",
      "/Users/Sparks/.codex",
    ),
    "/Users/Sparks/.codex/sessions/2026/09/03/thread.jsonl",
  );
  assert.equal(
    nativeMigrationTargetRolloutPath(
      "/root/.codex/archived_sessions/2026/08/31/thread.jsonl",
      "/root/.codex",
      "/Users/Sparks/.codex",
    ),
    "/Users/Sparks/.codex/archived_sessions/2026/08/31/thread.jsonl",
  );
});

void test("native migration queue parser preserves ordered text submissions", () => {
  const page = parseNativeMigrationQueueListResponse({
    data: [
      { id: "queued-1", input: [{ type: "text", text: "first" }], clientUserMessageId: "m-1" },
      { id: "queued-2", input: [{ type: "text", text: "second" }], clientUserMessageId: "m-2" },
    ],
    nextCursor: null,
  });
  const added = parseNativeMigrationQueueAddResponse({
    queuedSubmission: page.data[0],
  });
  assert.equal(added.queuedSubmission.clientUserMessageId, "m-1");
  assert.equal(
    nativeMigrationQueueMatches(page.data, [
      { ...page.data[0], id: "target-1" },
      { ...page.data[1], id: "target-2" },
    ]),
    true,
  );
  assert.equal(
    nativeMigrationQueueMatches(page.data, [
      { ...page.data[1], id: "target-1" },
      { ...page.data[0], id: "target-2" },
    ]),
    false,
  );
});

void test("native migration allows inline data attachments and classifies external references", () => {
  assert.equal(classifyNativeMigrationAttachmentReference("data:image/png;base64,AAAA"), "inline");
  assert.equal(
    classifyNativeMigrationAttachmentReference("/root/.codex/attachments/example.png"),
    "path",
  );
  assert.equal(
    classifyNativeMigrationAttachmentReference("https://example.invalid/image.png"),
    "external",
  );
});

void test("Gateway turn payloads always use full-access approval policy", () => {
  const params = buildTurnStartParams("thread-1", "message-1", {
    text: "inspect",
    approvalPolicy: "on-request",
  });
  assert.equal(GATEWAY_APPROVAL_POLICY, "never");
  assert.equal(params.approvalPolicy, "never");
});
