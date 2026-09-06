import { expect, test } from "@playwright/test";
import { E2E_USERNAME, openApp } from "./helpers/app";
import {
  applyGatewayLiveEvent,
  cacheSelectedThreadAndOpenThread,
  installRealtimeThreadSnapshotMock,
  openThreadInStore,
  receiveRealtimeThreadEvent,
  seedGatewayThread,
  selectedThreadStatusInStore,
} from "./helpers/gateway-store";
import { defaultGatewayProject } from "./fixtures/thread-history";
import { gatewayThreadFixture } from "./fixtures/gateway-thread";
import { appServerTurnFixture } from "./fixtures/app-server-turn";
import {
  deferredRealtimeTurnStartRequests,
  installDeferredRealtimeTurnStartRoute,
  releaseDeferredRealtimeTurnStartRoute,
} from "./helpers/realtime-route";
import { z } from "zod";

const storedRouteSelectionSchema = z.object({
  hostId: z.number().nullable(),
  projectId: z.number().nullable(),
  threadId: z.string().nullable(),
});

test("intermediate steps start expanded while active and collapse after completion", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-intermediate-runtime-transition";
  const startedAt = Math.floor(Date.now() / 1000) - 2;
  const runningTurn = appServerTurnFixture({
    id: "turn-intermediate-runtime-transition",
    status: "inProgress",
    startedAt,
    items: [
      {
        id: "user-intermediate-runtime-transition",
        type: "userMessage",
        content: [{ type: "text", text: "show live work from the beginning" }],
      },
      {
        id: "reasoning-intermediate-runtime-transition",
        type: "reasoning",
        status: "inProgress",
        summary: ["Live work should already be visible"],
      },
    ],
  });
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Intermediate runtime transition" },
    history: { thread: { id: threadId, turns: [runningTurn] } },
    status: "idle",
  });

  const intermediateToggle = page.getByRole("button", {
    name: /Intermediate steps|中间过程/,
  });
  await expect(intermediateToggle).toHaveAttribute("data-state", "open");
  await expect(page.getByText("Live work should already be visible")).toBeVisible();
  await expect(page.getByTestId("intermediate-steps-working")).toHaveCount(0);
  await expect(page.getByTestId("intermediate-header-duration")).toHaveCount(0);
  await expect(page.getByTestId("message-timestamp")).toHaveAttribute(
    "datetime",
    new Date(startedAt * 1000).toISOString(),
  );

  await page.evaluate((threadId) => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    driver.runtime.setThreadStatus(1, threadId, "running", {
      turnId: "turn-intermediate-runtime-transition",
    });
  }, threadId);

  await expect(intermediateToggle).toHaveAttribute("data-state", "open");
  await expect(page.getByText("Live work should already be visible")).toBeVisible();
  await expect(page.getByTestId("intermediate-steps-working")).toBeVisible();
  await expect(page.getByTestId("intermediate-header-duration")).toBeVisible();

  const completedTurn = appServerTurnFixture({
    ...runningTurn,
    status: "completed",
    completedAt: startedAt + 3,
    durationMs: 3_000,
    items: [
      ...runningTurn.items,
      {
        id: "agent-intermediate-runtime-transition-final",
        type: "agentMessage",
        phase: "final_answer",
        status: "completed",
        text: "The live work is complete",
      },
    ],
  });
  await applyGatewayLiveEvent(page, {
    id: 1,
    hostId: 1,
    threadId,
    method: "turn/completed",
    payload: { method: "turn/completed", params: { threadId, turn: completedTurn } },
    createdAt: new Date().toISOString(),
  });

  await expect(page.getByText("The live work is complete")).toBeVisible();
  await expect(intermediateToggle).toHaveAttribute("data-state", "closed");
  await expect(page.getByText("Live work should already be visible")).toHaveCount(0);
  await expect(page.getByTestId("intermediate-steps-working")).toHaveCount(0);
  await expect(page.getByTestId("intermediate-header-duration")).toHaveCount(0);
  await expect(page.getByTestId("message-timestamp")).toHaveCount(2);
  await expect(page.getByTestId("message-timestamp").last()).toHaveAttribute(
    "datetime",
    new Date((startedAt + 3) * 1000).toISOString(),
  );

  await intermediateToggle.click();
  await expect(intermediateToggle).toHaveAttribute("data-state", "open");
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Live work should already be visible" }),
  ).toBeVisible();
  await intermediateToggle.click();
  await expect(intermediateToggle).toHaveAttribute("data-state", "closed");
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Live work should already be visible" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("reasoning-duration")).toHaveCount(0);
});

test("opening completed history does not show fake thinking", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => undefined,
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string) => {
        if (command === "copy" && document.activeElement instanceof HTMLTextAreaElement) {
          Reflect.set(window, "__copiedAgentResponse", document.activeElement.value);
        }
        return true;
      },
    });
  });
  await openApp(page);
  const threadId = "e2e-completed-thread";
  const codeSnippet = "read and apply:\n/root/AGENTS.md\n/root/project/AGENTS.md";
  const fullAgentResponse = [
    "done",
    "",
    "A complete second paragraph.",
    "",
    "```text",
    codeSnippet,
    "```",
  ].join("\n");
  const startedEvent = {
    id: 1,
    hostId: 1,
    threadId,
    method: "turn/started",
    payload: {
      method: "turn/started",
      params: { threadId, turn: appServerTurnFixture({ id: "turn-1" }) },
    },
    createdAt: "2026-07-02T10:00:00.000Z",
  };
  const completedTurn = appServerTurnFixture({
    id: "turn-1",
    status: "completed",
    startedAt: 1_782_986_400,
    completedAt: 1_782_986_402.5,
    durationMs: 2_500,
    items: [
      {
        id: "user-1",
        type: "userMessage",
        content: [{ type: "text", text: "completed history" }],
      },
      {
        id: "reasoning-1",
        type: "reasoning",
        status: "completed",
        summary: ["intermediate work"],
      },
      {
        id: "agent-1",
        type: "agentMessage",
        phase: "final_answer",
        text: fullAgentResponse,
      },
    ],
  });
  const completedEvent = {
    id: 2,
    hostId: 1,
    threadId,
    method: "turn/completed",
    payload: { method: "turn/completed", params: { threadId, turn: completedTurn } },
    createdAt: "2026-07-02T10:00:01.000Z",
  };
  const activeTurn = appServerTurnFixture({
    ...completedTurn,
    status: "inProgress",
    completedAt: null,
    durationMs: null,
  });
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Completed UI", status: { type: "idle" } },
    history: { thread: { id: threadId, turns: [activeTurn] } },
    events: [startedEvent],
    loading: true,
    status: "running",
  });

  await expect(page.getByText("completed history").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Intermediate steps|中间过程/ })).toHaveAttribute(
    "data-state",
    "open",
  );
  await expect(page.getByText("intermediate work")).toBeVisible();
  await expect(page.getByTestId("stop-turn-button")).toBeVisible();
  const composerInput = page.getByPlaceholder(/Ask for follow-up changes|输入后续修改要求/);
  await composerInput.fill("A steer draft must not replace the desktop stop control");
  await expect(page.getByTestId("stop-turn-button")).toBeVisible();
  await expect(page.getByTestId("send-turn-button")).toBeVisible();
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", /Send|发送/);
  await composerInput.fill("");
  await expect(page.getByTestId("agent-message-actions")).toHaveCount(0);
  await expect(page.getByText(/Turn duration|本轮用时/)).toHaveCount(0);

  await applyGatewayLiveEvent(page, completedEvent);

  const completedIntermediateToggle = page.getByRole("button", {
    name: /Intermediate steps|中间过程/,
  });
  await expect(completedIntermediateToggle).toHaveAttribute("data-state", "closed");
  await expect(page.getByText("intermediate work")).toHaveCount(0);
  await expect(page.getByTestId("stop-turn-button")).toHaveCount(0);
  const agentActions = page.getByTestId("agent-message-actions");
  await expect(agentActions).toBeVisible();
  await expect
    .poll(() => agentActions.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("1");
  await expect(agentActions.getByText(/Turn duration 2\.50s|本轮用时 2\.50s/)).toBeVisible();
  const copyResponseButton = agentActions.getByRole("button", {
    name: /Copy full response|复制完整回复/,
  });
  await expect(copyResponseButton).toBeVisible();
  await copyResponseButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __copiedAgentResponse?: string }).__copiedAgentResponse,
      ),
    )
    .toBe(fullAgentResponse);
  await expect(
    page.locator("[data-sonner-toast]").getByText(/Full response copied|完整回复已复制/),
  ).toBeVisible();
  const copyCodeButton = page.getByTestId("copy-markdown-code-button");
  await expect(copyCodeButton).toBeVisible();
  await copyCodeButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __copiedAgentResponse?: string }).__copiedAgentResponse,
      ),
    )
    .toBe(`${codeSnippet}\n`);
  await expect(copyCodeButton).toHaveText(/Code copied|代码已复制/);
  await expect(page.getByText(/Thinking|思考中/)).toBeHidden();

  await seedGatewayThread(page, {
    threadId: "e2e-stale-running-history-thread",
    currentThread: { id: "e2e-stale-running-history-thread", name: "Stale Running History" },
    history: {
      thread: {
        id: "e2e-stale-running-history-thread",
        turns: [{ id: "turn-stale-running", status: "inProgress", items: [] }],
      },
    },
    status: "completed",
  });
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Completed|已完成/,
  );
});

test("opening a cached thread applies terminal events before deriving composer state", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-cached-terminal-thread";
  const staleTurn = appServerTurnFixture({
    id: "turn-stale-1",
    status: "inProgress",
    items: [
      {
        id: "user-stale-1",
        type: "userMessage",
        content: [{ type: "text", text: "stale cached request" }],
      },
    ],
  });
  const completedTurn = appServerTurnFixture({
    ...staleTurn,
    status: "completed",
    items: [
      ...staleTurn.items,
      {
        id: "agent-stale-1",
        type: "agentMessage",
        phase: "final_answer",
        text: "cached turn is done",
      },
    ],
  });

  await installRealtimeThreadSnapshotMock(page, {
    snapshots: {
      [threadId]: {
        thread: { id: threadId, name: "Cached Terminal Thread" },
        history: { thread: { id: threadId, turns: [completedTurn] } },
        threadSettings: {},
        tokenUsage: null,
        projectId: 1,
        project: defaultGatewayProject(),
        turnsPage: { nextCursor: null, backwardsCursor: null },
        recentEvents: [
          {
            id: 1,
            hostId: 1,
            threadId,
            method: "turn/completed",
            payload: { method: "turn/completed", params: { threadId, turn: completedTurn } },
            createdAt: new Date().toISOString(),
          },
        ],
        lastEventId: 1,
      },
    },
  });
  await seedGatewayThread(page, { projectId: 1 });
  await openThreadInStore(page, { threadId, hostId: 1, projectId: 1 });

  await expect(page.getByText("cached turn is done")).toBeVisible();
  await expect.poll(() => selectedThreadStatusInStore(page)).toBe("completed");
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Completed|已完成/,
  );
});

test("opening a thread stores browser-local last open selection", async ({ page }) => {
  await openApp(page);
  const threadId = "e2e-local-last-open-thread";
  await installRealtimeThreadSnapshotMock(page, {
    snapshots: {
      [threadId]: {
        thread: { id: threadId, name: "Local Last Open Thread" },
        history: { thread: { id: threadId, turns: [] } },
        projectId: 1,
        project: defaultGatewayProject(),
      },
    },
  });
  await seedGatewayThread(page, { projectId: 1, threadId: null });

  await openThreadInStore(page, { threadId, hostId: 1, projectId: 1 });

  await expect
    .poll(async () => {
      const stored = await page.evaluate(
        (username) =>
          localStorage.getItem(`codex-gateway:${encodeURIComponent(username)}:last-open-thread`),
        E2E_USERNAME,
      );
      return stored === null ? null : storedRouteSelectionSchema.parse(JSON.parse(stored));
    })
    .toEqual({ hostId: 1, projectId: 1, threadId });
});

test("switching to cached thread history renders without waiting for the next event", async ({
  page,
}) => {
  await openApp(page);
  const secondThreadId = "e2e-visible-second-thread";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId: secondThreadId,
    currentThread: { id: secondThreadId, name: "Second Visible Thread" },
    history: {
      thread: {
        id: secondThreadId,
        turns: [
          {
            id: "turn-visible-second",
            status: "completed",
            items: [
              {
                id: "agent-visible-second",
                type: "agentMessage",
                status: "completed",
                text: "second cached thread should be visible immediately",
              },
            ],
          },
        ],
      },
    },
  });

  await expect(
    page
      .getByTestId("chat-scroll-area")
      .getByText("second cached thread should be visible immediately"),
  ).toBeVisible();
});

test("accepted send stays with its original thread after immediate navigation", async ({
  page,
}) => {
  await openApp(page);
  const originalThreadId = "e2e-send-before-switch-original";
  const nextThreadId = "e2e-send-before-switch-next";
  const acceptedTurnId = "turn-send-before-switch";
  installDeferredRealtimeTurnStartRoute(
    page,
    appServerTurnFixture({ id: acceptedTurnId, status: "inProgress", items: [] }),
  );
  await seedGatewayThread(page, {
    projectId: 1,
    threadId: originalThreadId,
    currentThread: { id: originalThreadId, name: "Original send target" },
    history: { thread: { id: originalThreadId, turns: [] } },
    status: "idle",
    threadViews: {
      [`1:${nextThreadId}`]: {
        hostId: 1,
        projectId: 1,
        threadId: nextThreadId,
        currentThread: gatewayThreadFixture(
          { id: nextThreadId, name: "Next selected thread" },
          { projectId: 1 },
        ),
        history: { thread: { id: nextThreadId, turns: [] } },
        events: [],
        olderTurnsCursor: null,
        newerTurnsCursor: null,
        lastEventId: 0,
        eventEpoch: "",
        loading: false,
        error: null,
      },
    },
  });

  await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    void driver.turns.sendTurn("This send must remain on the original thread", {
      model: "gpt-5.6-sol",
    });
  });
  await expect.poll(() => deferredRealtimeTurnStartRequests(page).length).toBe(1);

  await page.evaluate((nextThreadId) => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const view = driver.views.threadViews[`1:${nextThreadId}`];
    if (!view) throw new Error("Next thread view is unavailable");
    driver.navigation.selectedThreadId = nextThreadId;
    driver.views.currentThread = view.currentThread;
    driver.views.history = view.history;
    driver.views.timelineTurns = view.timelineTurns;
    driver.views.events = view.events;
    driver.views.loading = true;
  }, nextThreadId);
  releaseDeferredRealtimeTurnStartRoute(page);

  await expect
    .poll(() =>
      page.evaluate(
        ({ originalThreadId, acceptedTurnId }) => {
          const driver = window.__codexGatewayE2e;
          if (!driver) throw new Error("Gateway E2E driver is unavailable");
          return driver.views.threadViews[`1:${originalThreadId}`]?.history?.thread.turns.some(
            (turn) => turn.id === acceptedTurnId,
          );
        },
        { originalThreadId, acceptedTurnId },
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      ({ nextThreadId, acceptedTurnId }) => {
        const driver = window.__codexGatewayE2e;
        if (!driver) throw new Error("Gateway E2E driver is unavailable");
        return {
          selectedThreadId: driver.navigation.selectedThreadId,
          nextHasAcceptedTurn: driver.views.threadViews[
            `1:${nextThreadId}`
          ]?.history?.thread.turns.some((turn) => turn.id === acceptedTurnId),
          selectedLoading: driver.views.loading,
          originalModel:
            driver.composer.threadSettingsByKey[`1:${originalThreadId}`]?.model ?? null,
          nextModel: driver.composer.threadSettingsByKey[`1:${nextThreadId}`]?.model ?? null,
        };
      },
      { originalThreadId, nextThreadId, acceptedTurnId },
    ),
  ).toEqual({
    selectedThreadId: nextThreadId,
    nextHasAcceptedTurn: false,
    selectedLoading: true,
    originalModel: "gpt-5.6-sol",
    nextModel: null,
  });
});

test("live terminal event updates selected thread even when snapshot cursor is ahead", async ({
  page,
}) => {
  await openApp(page);
  const cursorThreadId = "e2e-terminal-cursor-thread";
  const turnId = "turn-terminal-cursor";
  const runningTurn = appServerTurnFixture({
    id: turnId,
    status: "inProgress",
    items: [
      {
        id: "user-terminal-cursor",
        type: "userMessage",
        content: [{ type: "text", text: "cursor race request" }],
      },
    ],
  });
  const completedTurn = appServerTurnFixture({
    ...runningTurn,
    status: "completed",
    items: [
      ...runningTurn.items,
      {
        id: "agent-terminal-cursor",
        type: "agentMessage",
        phase: "final_answer",
        text: "cursor race done",
      },
    ],
  });
  await seedGatewayThread(page, {
    projectId: 1,
    threadId: cursorThreadId,
    currentThread: { id: cursorThreadId, name: "Cursor Race Thread" },
    history: { thread: { id: cursorThreadId, turns: [runningTurn] } },
    status: "running",
    lastEventId: 10,
    eventEpoch: "e2e-event-epoch",
    threadViews: {
      "1:e2e-terminal-cursor-thread": {
        hostId: 1,
        projectId: 1,
        threadId: cursorThreadId,
        currentThread: gatewayThreadFixture(
          { id: cursorThreadId, name: "Cursor Race Thread" },
          { projectId: 1 },
        ),
        history: { thread: { id: cursorThreadId, turns: [runningTurn] } },
        events: [],
        olderTurnsCursor: null,
        newerTurnsCursor: null,
        lastEventId: 11,
        eventEpoch: "e2e-event-epoch",
        loading: false,
        error: null,
      },
    },
  });
  await receiveRealtimeThreadEvent(page, {
    id: 11,
    hostId: 1,
    threadId: cursorThreadId,
    method: "turn/completed",
    payload: {
      method: "turn/completed",
      params: { threadId: cursorThreadId, turn: completedTurn },
    },
    createdAt: new Date().toISOString(),
  });

  await expect(page.getByText("cursor race done")).toBeVisible();
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Completed|已完成/,
  );
});

test("context compaction duration survives event replay timing", async ({ page }) => {
  await openApp(page);
  const threadId = "e2e-context-compaction-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Context Compaction" },
    history: { thread: { id: threadId, turns: [] } },
    status: "running",
  });
  await applyGatewayLiveEvent(page, {
    id: 401,
    hostId: 1,
    threadId,
    method: "item/started",
    payload: {
      method: "item/started",
      params: {
        threadId,
        turnId: "turn-context",
        startedAtMs: Date.parse("2026-07-02T10:00:00.000Z"),
        item: {
          id: "context-compaction",
          type: "contextCompaction",
          status: "inProgress",
        },
      },
    },
    createdAt: "2026-07-02T10:00:02.000Z",
  });
  await applyGatewayLiveEvent(page, {
    id: 402,
    hostId: 1,
    threadId,
    method: "item/completed",
    payload: {
      method: "item/completed",
      params: {
        threadId,
        turnId: "turn-context",
        completedAtMs: Date.parse("2026-07-02T10:00:04.250Z"),
        item: {
          id: "context-compaction",
          type: "contextCompaction",
          status: "completed",
        },
      },
    },
    createdAt: "2026-07-02T10:00:09.000Z",
  });

  const chatScrollArea = page.getByTestId("chat-scroll-area");
  await expect(chatScrollArea.getByText(/Context compaction|压缩上下文/)).toBeVisible();
  await expect(chatScrollArea.getByText("4.25s")).toBeVisible();
  await expect(chatScrollArea.getByText("0.00s")).toBeHidden();
});

test("turn completed keeps thread running while context compaction is active", async ({ page }) => {
  await openApp(page);
  const threadId = "e2e-context-compaction-active-after-turn";
  const activeCompactionTurn = appServerTurnFixture({
    id: "turn-context-active",
    status: "completed",
    items: [
      {
        id: "context-compaction-active",
        type: "contextCompaction",
        status: "inProgress",
        startedAt: Date.parse("2026-07-02T10:00:00.000Z"),
      },
    ],
  });

  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Active Context After Turn" },
    history: { thread: { id: threadId, turns: [] } },
    status: "running",
  });
  await applyGatewayLiveEvent(page, {
    id: 410,
    hostId: 1,
    threadId,
    method: "turn/completed",
    payload: {
      method: "turn/completed",
      params: {
        threadId,
        turn: activeCompactionTurn,
      },
    },
    createdAt: "2026-07-02T10:00:01.000Z",
  });

  await expect.poll(() => selectedThreadStatusInStore(page)).toBe("running");
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Stop generation|停止生成/,
  );
  await expect(page.getByText(/Context compaction|压缩上下文/)).toBeVisible();
});

test("restoring a cached thread uses app-server snapshot state for active context compaction", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-active-context-cache-thread";
  const activeContextHistory = {
    thread: {
      id: threadId,
      turns: [
        {
          id: "turn-context-running",
          status: "completed",
          items: [
            {
              id: "context-compaction-running",
              type: "contextCompaction",
              status: "inProgress",
              startedAt: Date.parse("2026-07-02T10:00:00.000Z"),
            },
          ],
        },
      ],
    },
  };
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Active Context Cache" },
    history: activeContextHistory,
    status: "completed",
  });
  await installRealtimeThreadSnapshotMock(page, {
    snapshots: {
      [threadId]: {
        thread: {
          id: threadId,
          name: "Active Context Cache",
          status: { type: "active", activeFlags: [] },
        },
        history: activeContextHistory,
        runtimeStatus: "running",
      },
    },
  });
  await cacheSelectedThreadAndOpenThread(page, {
    threadId,
    hostId: 1,
    otherThreadId: "e2e-other-thread",
    otherThreadName: "Other Thread",
  });

  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Stop generation|停止生成/,
  );
  await expect(page.getByText(/Context compaction|压缩上下文/)).toBeVisible();
});
