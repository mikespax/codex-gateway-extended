import assert from "node:assert/strict";
import test from "node:test";
import {
  compactSidebarGoal,
  compactSidebarSummary,
  currentOperationFromTurns,
  currentOperationFromThread,
  lastCompletedTurnSummaryFromThread,
  lastUserInputFromThread,
  operationForItem,
  sidebarOverviewForThread,
  sidebarSummaryForThread,
  threadGoalSummaryFromTurns,
  threadGoalSummaryFromThread,
} from "../../app/utils/thread-sidebar-summary";
import type { AppServerThread } from "../../shared/types";

const thread = (
  input: Partial<Pick<AppServerThread, "status" | "turns">>,
): Pick<AppServerThread, "status" | "turns"> => ({
  status: { type: "idle" },
  turns: [],
  ...input,
});

const turn = (
  input: Pick<AppServerThread["turns"][number], "status" | "items">,
): AppServerThread["turns"][number] => ({
  id: "turn-1",
  itemsView: "full",
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  ...input,
});

void test("sidebar summaries preserve the full goal sentence", () => {
  assert.equal(compactSidebarSummary("  Migrate   all Codex threads now  "), "Migrate all Codex");
  assert.equal(compactSidebarSummary(""), null);
  assert.equal(
    sidebarSummaryForThread({
      goalObjective: "Migrate all Codex threads",
      goalStatus: "active",
      currentOperation: "Running a command",
    }),
    "Migrate all Codex threads",
  );
  assert.equal(
    sidebarSummaryForThread({
      goalObjective: "Finished work",
      goalStatus: "complete",
      currentOperation: "Updating files",
    }),
    "Updating files",
  );
});

void test("goal labels stay compact while the full objective remains available to the tooltip", () => {
  assert.equal(
    compactSidebarGoal("Please migrate all Codex threads off the VPS"),
    "migrate all Codex threads",
  );
  assert.equal(compactSidebarGoal("Repair Gateway"), "Repair Gateway");
  assert.equal(compactSidebarGoal(""), null);
});

void test("operation labels stay descriptive and do not expose command contents", () => {
  assert.equal(
    operationForItem({ type: "commandExecution", command: "cat secret.txt" }),
    "Running a command",
  );
  assert.equal(operationForItem({ type: "fileChange" }), "Updating files");
  assert.equal(operationForItem({ type: "requestUserInput" }), "Waiting for input");
  assert.equal(operationForItem({ type: "reasoning" }), "Thinking through the change");
});

void test("thread list summaries use its latest goal and active operation", () => {
  const active = thread({
    status: { type: "active", activeFlags: [] },
    turns: [
      turn({
        status: "inProgress",
        items: [
          {
            id: "goal-1",
            type: "threadGoal",
            objective: "Repair Gateway history",
            status: "active",
          },
        ],
      }),
    ],
  });
  assert.deepEqual(threadGoalSummaryFromThread(active), {
    objective: "Repair Gateway history",
    status: "active",
  });
  assert.equal(currentOperationFromThread(active), "Working");

  const runningCommand = thread({
    status: { type: "active", activeFlags: [] },
    turns: [
      turn({
        status: "inProgress",
        items: [{ id: "cmd-1", type: "commandExecution", command: "pnpm test" }],
      }),
    ],
  });
  assert.equal(currentOperationFromThread(runningCommand), "Running a command");
  assert.equal(
    currentOperationFromTurns([
      turn({
        status: "inProgress",
        items: [{ id: "cmd-2", type: "commandExecution", command: "pnpm test" }],
      }),
    ]),
    "Running a command",
  );
  assert.deepEqual(
    threadGoalSummaryFromTurns([
      turn({
        status: "completed",
        items: [
          {
            id: "goal-2",
            type: "threadGoal",
            objective: "Keep the sidebar summaries current",
            status: "active",
          },
        ],
      }),
    ]),
    { objective: "Keep the sidebar summaries current", status: "active" },
  );
});

void test("thread overview captures the last completed turn and latest user input", () => {
  const value = thread({
    status: { type: "idle" },
    turns: [
      turn({
        status: "completed",
        items: [
          {
            id: "user-1",
            type: "userMessage",
            content: [{ text: "Please inspect the gateway refresh path" }],
          },
          { id: "agent-1", type: "agentMessage", text: "The refresh path is healthy." },
        ],
      }),
    ],
  });
  assert.equal(lastCompletedTurnSummaryFromThread(value), "The refresh path is healthy.");
  assert.equal(lastUserInputFromThread(value), "Please inspect the gateway refresh path");
  assert.deepEqual(
    sidebarOverviewForThread({
      goalObjective: "Keep the Gateway healthy",
      goalStatus: "active",
      currentOperation: "Waiting approval",
      turnSummary: lastCompletedTurnSummaryFromThread(value),
      lastUserInput: lastUserInputFromThread(value),
    }),
    {
      goal: "Keep the Gateway healthy",
      turnSummary: "The refresh path is healthy.",
      currentTask: "Waiting approval",
      lastUserInput: "Please inspect the gateway refresh path",
    },
  );
  assert.deepEqual(
    sidebarOverviewForThread({
      aiGoalSummary: "Keep the sidebar useful",
      currentOperation: "Working",
    }),
    {
      goal: "Keep the sidebar useful",
      turnSummary: null,
      currentTask: "Working",
      lastUserInput: null,
    },
  );
});
