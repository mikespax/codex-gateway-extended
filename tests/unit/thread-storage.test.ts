import assert from "node:assert/strict";
import test from "node:test";
import {
  buildThreadStorageScanCommand,
  isThreadStoragePathInCodexSessions,
  parseThreadStorageScanOutput,
  ThreadStorageScanner,
  THREAD_STORAGE_SCAN_TIMEOUT_MS,
} from "../../server/utils/gateway/infra/codex/thread-storage";
import {
  formatThreadSize,
  threadStorageTone,
} from "../../app/components/sidebar/thread-list/thread-size";
import type { HostRecord } from "../../shared/types";

const host = {
  id: 7,
  name: "test-host",
  sshHost: "127.0.0.1",
  username: "codex",
  port: 22,
  authMode: "agent",
  privateKeyPath: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies HostRecord;

void test("thread storage formatting uses MB below 1 GB and one-decimal GB above it", () => {
  assert.equal(formatThreadSize(0), "0 MB");
  assert.equal(formatThreadSize(999 * 1_024 * 1_024), "999 MB");
  assert.equal(formatThreadSize(1_024 * 1_024 * 1_024), "1.0 GB");
  assert.equal(formatThreadSize(null), "—");
  assert.equal(threadStorageTone(999 * 1_024 * 1_024), "green");
  assert.equal(threadStorageTone(1_024 * 1_024 * 1_024), "amber");
  assert.equal(threadStorageTone(2 * 1_024 * 1_024 * 1_024), "red");
  assert.equal(threadStorageTone(undefined), "muted");
});

void test("thread storage output ignores malformed or out-of-range rows", () => {
  assert.deepEqual(
    [...parseThreadStorageScanOutput("0\t42\n1\t999999999999999999999\nnope", ["a", "b"])],
    [["a", 42]],
  );
  assert.equal(
    isThreadStoragePathInCodexSessions(
      "/home/codex/.codex/sessions/2026/09/03/rollout.jsonl",
      "/home/codex/.codex",
    ),
    true,
  );
  assert.equal(
    isThreadStoragePathInCodexSessions(
      "/home/codex/.codex/sessions-other/rollout.jsonl",
      "/home/codex/.codex",
    ),
    false,
  );
});

void test("thread storage scan command scopes rollout and attachments to Codex roots", () => {
  const command = buildThreadStorageScanCommand([
    { id: "thread-a", path: "/home/codex/.codex/sessions/a.jsonl" },
  ]);
  assert.match(command, /sessions_root/);
  assert.match(command, /archived_root/);
  assert.match(command, /attachment_root/);
  assert.match(command, /inside_root/);
  assert.match(command, /grep -aoE/);
  assert.match(command, /sort -u/);
  assert.doesNotMatch(command, /du -sk.*cwd/);
});

void test("thread storage scanner performs one bulk scan and caches results for one minute", async () => {
  let now = 10_000;
  let calls = 0;
  let timeout: number | undefined;
  const scanner = new ThreadStorageScanner(
    {
      exec: async (_host, _command, options) => {
        calls += 1;
        timeout = options?.timeoutMs;
        return { code: 0, stdout: "0\t123\n1\t456\n", stderr: "" };
      },
    },
    () => now,
  );
  const scanHost = host;
  const threads = [
    { id: "a", path: "/home/codex/.codex/sessions/a.jsonl" },
    { id: "b", path: "/home/codex/.codex/sessions/b.jsonl" },
  ];
  assert.deepEqual(
    [...(await scanner.scan(scanHost, threads))],
    [
      ["a", 123],
      ["b", 456],
    ],
  );
  assert.deepEqual(
    [...(await scanner.scan(scanHost, threads))],
    [
      ["a", 123],
      ["b", 456],
    ],
  );
  assert.equal(calls, 1);
  assert.equal(timeout, THREAD_STORAGE_SCAN_TIMEOUT_MS);
  now += 60_001;
  await scanner.scan(scanHost, threads);
  assert.equal(calls, 2);
});

void test("unresolved thread paths return neutral size data without a remote scan", async () => {
  let calls = 0;
  const scanner = new ThreadStorageScanner({
    exec: async () => {
      calls += 1;
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  const result = await scanner.scan({ ...host, id: 8 }, [{ id: "missing", path: null }]);
  assert.deepEqual([...result], [["missing", null]]);
  assert.equal(calls, 0);
});
