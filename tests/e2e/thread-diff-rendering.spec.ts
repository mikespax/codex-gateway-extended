import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import { seedGatewayThread } from "./helpers/gateway-store";
import type { ThreadHistoryState } from "../../shared/types";
import type { ThreadViewState } from "../../app/stores/gateway/types";
import { projectThreadTimelineHistory } from "../../shared/thread-history/timeline";
import { gatewayThreadFixture } from "./fixtures/gateway-thread";
import { compactCompletedFileChangeRuns } from "../../app/components/thread/completed-file-change-runs";

test("compacts consecutive completed file-change steps into one summary", () => {
  const items = [3, 1, 2, 2, 1, 1].map((count, index) => ({
    id: `file-change-${index}`,
    type: "fileChange" as const,
    status: "completed",
    changes: Array.from({ length: count }, (_, changeIndex) => ({
      path: `/tmp/file-${index}-${changeIndex}.txt`,
      kind: "update",
    })),
  }));

  const compacted = compactCompletedFileChangeRuns(items);
  expect(compacted).toHaveLength(1);
  expect(compacted[0]?.type).toBe("fileChange");
  expect(compacted[0]?.changes).toHaveLength(10);
  expect(compacted[0]?.aggregatedStepCount).toBe(6);
});

test("expanded intermediate steps keep file summaries but hide code-change details", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-diff-thread";
  const workspaceRoot = "/workspace/diff-ui";
  const changedFilePath = `${workspaceRoot}/src/example.py`;
  const diff = [
    "diff --git a/src/example.py b/src/example.py",
    "index 1111111..2222222 100644",
    "--- a/src/example.py",
    "+++ b/src/example.py",
    "@@ -1,2 +1,3 @@",
    " print('before')",
    "-old_value = 'short'",
    "+new_value = 'this is a deliberately long changed line to require horizontal scrolling in the diff viewport'",
    "+print(new_value)",
  ].join("\n");

  await seedGatewayThread(page, {
    threadId,
    projectId: 1,
    currentThread: { id: threadId, name: "Diff UI", cwd: workspaceRoot },
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "turn-1",
            status: "running",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "edit a file" }],
              },
              {
                id: "file-change-1",
                type: "fileChange",
                status: "completed",
                changes: [{ path: changedFilePath, kind: "update", diff }],
              },
            ],
          },
        ],
      },
    },
  });

  await openIntermediateSteps(page);
  await expect(page.getByTestId("file-change-summary")).toBeVisible();
  await expect(page.getByRole("button", { name: /src\/example\.py/ })).toHaveCount(0);
  await expect(page.getByText("new_value =")).toHaveCount(0);
  await expect(page.locator(".diff-markdown")).toHaveCount(0);
});

test("active routine commands and empty reasoning collapse into one working row", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-compact-live-work-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Compact Live Work" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "turn-short-command",
            status: "running",
            startedAt: Math.floor(Date.now() / 1000) - 5,
            items: [
              {
                id: "agent-progress-1",
                type: "agentMessage",
                text: "I am checking the relevant files now.",
              },
              {
                id: "command-short-1",
                type: "commandExecution",
                status: "completed",
                command: "/bin/zsh -lc 'pwd && printf \"done\"'",
                aggregatedOutput: "/tmp/e2e\n",
              },
              {
                id: "reasoning-empty-1",
                type: "reasoning",
                status: "completed",
              },
              {
                id: "command-plain-1",
                type: "commandExecution",
                status: "inProgress",
                command: "sleep 10",
                aggregatedOutput: "",
              },
              {
                id: "command-approval-1",
                type: "commandExecution",
                status: "inProgress",
                command: "deploy production",
                pendingApproval: {
                  requestId: "approval-1",
                  method: "item/commandExecution/requestApproval",
                  params: { reason: "Production permission is required" },
                },
              },
            ],
          },
        ],
      },
    },
  });

  const compactToggle = page.getByRole("button", { name: /Intermediate steps|中间过程/ });
  // A stale approval from a rollout created before the full-access invariant is the one safety
  // exception: keep it visible so an old turn cannot freeze behind a collapsed Working row.
  await expect(compactToggle).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("intermediate-latest-operation-header")).toContainText(
    "deploy production",
  );
  await openIntermediateSteps(page);
  await expect(page.getByText("I am checking the relevant files now.")).toBeVisible();
  await expect(page.getByTestId("intermediate-working-status")).toHaveCount(1);
  await expect(page.getByTestId("intermediate-working-status")).toContainText(/Working|处理中/);
  await expect(page.getByTestId("intermediate-working-duration")).toContainText(/\d/);
  await expect(page.getByRole("button", { name: /pwd && printf "done"/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /sleep 10/ })).toHaveCount(0);
  await expect(page.getByText(/Thinking|思考中/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /deploy production/ })).toBeVisible();
  await expect(page.getByText(/Waiting for approval|等待审批/)).toBeVisible();
});

test("completed routine commands stay hidden while narrative and file summaries remain", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-compact-completed-work-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Compact Completed Work" },
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "turn-completed-routine",
            status: "completed",
            items: [
              {
                id: "completed-user",
                type: "userMessage",
                content: [{ type: "text", text: "Summarize the completed work" }],
              },
              {
                id: "completed-agent-progress",
                type: "agentMessage",
                text: "I checked the relevant files and completed the requested update.",
              },
              {
                id: "completed-command",
                type: "commandExecution",
                status: "completed",
                command: "sed -n '1,240p' app/components/thread/timeline-rows.ts",
              },
              {
                id: "completed-empty-reasoning",
                type: "reasoning",
                status: "completed",
              },
              {
                id: "completed-collab-tool",
                type: "collabAgentToolCall",
                status: "completed",
              },
              {
                id: "completed-file-change",
                type: "fileChange",
                status: "completed",
                changes: [{ path: "/workspace/src/example.ts", kind: "update" }],
              },
              {
                id: "completed-final",
                type: "agentMessage",
                phase: "final_answer",
                text: "The requested update is complete.",
              },
            ],
          },
        ],
      },
    },
  });

  await expect(page.getByRole("button", { name: /Intermediate steps|中间过程/ })).toHaveAttribute(
    "data-state",
    "closed",
  );
  await openIntermediateSteps(page);
  await expect(
    page.getByText("I checked the relevant files and completed the requested update."),
  ).toBeVisible();
  await expect(page.getByTestId("file-change-summary")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /sed -n '1,240p' app\/components\/thread\/timeline-rows\.ts/,
    }),
  ).toHaveCount(0);
  await expect(page.getByText(/Thinking|思考中/)).toHaveCount(0);
});

test("multiple steers remain visible between their own intermediate sections", async ({ page }) => {
  await openApp(page);
  const threadId = "e2e-steered-intermediate-sections";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Steered sections" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "turn-steered-sections",
            status: "running",
            startedAt: Math.floor(Date.now() / 1000) - 65,
            items: [
              {
                id: "user-original",
                type: "userMessage",
                content: [{ type: "text", text: "Original request shown first" }],
              },
              {
                id: "agent-progress-original",
                type: "agentMessage",
                text: "Progress for the original request",
              },
              {
                id: "steer-one",
                clientId: "steer-one",
                type: "userMessage",
                content: [{ type: "text", text: "First steer remains visible" }],
              },
              {
                id: "command-after-steer-one",
                type: "commandExecution",
                status: "completed",
                command: "routine command after first steer",
              },
              {
                id: "agent-progress-steer-one",
                type: "agentMessage",
                text: "Progress after the first steer",
              },
              {
                id: "steer-two",
                clientId: "steer-two",
                type: "userMessage",
                content: [{ type: "text", text: "Second steer remains visible" }],
              },
              {
                id: "collab-after-steer-two",
                type: "collabAgentToolCall",
                status: "inProgress",
              },
            ],
          },
        ],
      },
    },
  });

  await expect(page.getByText("Original request shown first")).toBeVisible();
  await expect(page.getByText("First steer remains visible")).toBeVisible();
  await expect(page.getByText("Second steer remains visible")).toBeVisible();
  await expect(page.getByRole("button", { name: /Intermediate steps|中间过程/ })).toHaveCount(3);
  await expect(page.getByTestId("active-prompt-recall")).toHaveCount(0);
  await expect(page.getByTestId("intermediate-header-duration")).toContainText(/1m/);

  await page
    .getByRole("button", { name: /Intermediate steps|中间过程/ })
    .last()
    .click();
  await expect(page.getByText("Progress for the original request")).toBeVisible();
  await expect(page.getByText("Progress after the first steer")).toBeVisible();
  await expect(page.getByTestId("intermediate-working-status")).toHaveCount(1);
  await expect(page.getByText("routine command after first steer")).toHaveCount(0);
});

test("switching threads keeps hidden diff details out of the intermediate summary", async ({
  page,
}) => {
  await openApp(page);
  const diffThreadId = "e2e-async-diff-layout-thread";
  const shortThreadId = "e2e-async-diff-short-thread";
  const finalMarker = "final answer after the asynchronously highlighted diff";
  const diff = [
    "diff --git a/src/async.py b/src/async.py",
    "--- a/src/async.py",
    "+++ b/src/async.py",
    "@@ -1,1 +1,120 @@",
    ...Array.from(
      { length: 120 },
      (_, index) => `+async_diff_line_${String(index + 1).padStart(3, "0")} = ${index + 1}`,
    ),
  ].join("\n");
  const diffHistory = {
    thread: {
      id: diffThreadId,
      turns: [
        {
          id: "turn-async-diff",
          status: "running",
          items: [
            {
              id: "file-async-diff",
              type: "fileChange",
              status: "completed",
              changes: [{ path: "src/async.py", kind: "update", diff }],
            },
            {
              id: "agent-after-async-diff",
              type: "agentMessage",
              phase: "final_answer",
              text: finalMarker,
            },
          ],
        },
      ],
    },
  };
  const shortHistory = {
    thread: {
      id: shortThreadId,
      turns: [
        {
          id: "turn-short",
          status: "completed",
          items: [
            {
              id: "agent-short",
              type: "agentMessage",
              phase: "final_answer",
              text: "short thread content",
            },
          ],
        },
      ],
    },
  };

  await seedGatewayThread(page, {
    threadId: diffThreadId,
    projectId: 1,
    status: "running",
    currentThread: { id: diffThreadId, name: "Async Diff" },
    history: diffHistory,
    threads: [
      { id: diffThreadId, name: "Async Diff", updatedAt: 2 },
      { id: shortThreadId, name: "Short Thread", updatedAt: 1 },
    ],
    threadViews: {
      [`1:${diffThreadId}`]: cachedThreadView(diffThreadId, diffHistory),
      [`1:${shortThreadId}`]: cachedThreadView(shortThreadId, shortHistory),
    },
  });

  await page.getByTestId(`thread-button-${shortThreadId}`).click();
  await expect(page.getByText("short thread content")).toBeVisible();
  await page.getByTestId(`thread-button-${diffThreadId}`).click();
  await openIntermediateSteps(page);
  await expect(page.getByTestId("file-change-summary")).toBeVisible();
  await expect(page.getByRole("button", { name: /src\/async\.py/ })).toHaveCount(0);
  await expect(page.getByText("async_diff_line_120")).toHaveCount(0);
  await expect(page.getByText(finalMarker)).toBeVisible();
});

function cachedThreadView(threadId: string, history: ThreadHistoryState): ThreadViewState {
  const timelineTurns = projectThreadTimelineHistory(history).thread.turns;
  return {
    hostId: 1,
    projectId: 1,
    threadId,
    currentThread: gatewayThreadFixture({ id: threadId }, { projectId: 1 }),
    history,
    timelineTurns,
    events: [],
    olderTurnsCursor: null,
    newerTurnsCursor: null,
    lastEventId: 0,
    eventEpoch: "e2e-event-epoch",
    loading: false,
    error: null,
  };
}

async function openIntermediateSteps(page: import("@playwright/test").Page) {
  const toggle = page.getByRole("button", { name: /Intermediate steps|中间过程/ }).first();
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("data-state")) !== "open") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-state", "open");
}
