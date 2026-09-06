import type { Page } from "@playwright/test";
import type {
  GatewayThread,
  GatewayEvent,
  HostRecord,
  ModelRecord,
  ProjectRecord,
  ThreadGoalStatus,
  ThreadHistoryState,
  ThreadSettingsState,
  ThreadTimelineTurn,
  ThreadTokenUsageState,
} from "../../../shared/types";
import { projectThreadTimelineHistory } from "../../../shared/thread-history/timeline";
import type { ThreadViewState } from "../../../app/stores/gateway/types";
import {
  defaultGatewayHost,
  defaultGatewayProject,
  emptyThreadHistory,
} from "../fixtures/thread-history";
import { gatewayThreadFixture, type GatewayThreadFixture } from "../fixtures/gateway-thread";
import {
  installRealtimeInterruptRoute,
  installRealtimeServerRequestResponseRoute,
  installRealtimeThreadSnapshotRoute,
  realtimeInterruptRequest,
  realtimeServerRequestResponse,
  realtimeThreadActivateRequests,
  type MockThreadSnapshotInput,
} from "./realtime-route";

interface SeedGatewayThreadInput {
  hostId?: number;
  projectId?: number | null;
  threadId?: string | null;
  host?: HostRecord;
  project?: ProjectRecord | null;
  currentThread?: GatewayThreadFixture | null;
  history?: ThreadHistoryState | null;
  threads?: GatewayThreadFixture[];
  status?: "idle" | "running" | "completed" | "failed" | "interrupted";
  loading?: boolean;
  olderTurnsCursor?: string | null;
  newerTurnsCursor?: string | null;
  events?: GatewayEvent[];
  threadSettings?: ThreadSettingsState;
  tokenUsage?: ThreadTokenUsageState;
  models?: ModelRecord[];
  lastEventId?: number;
  eventEpoch?: string;
  threadViews?: Record<
    string,
    Omit<ThreadViewState, "timelineTurns"> & { timelineTurns?: ThreadTimelineTurn[] }
  >;
}

type SeedGatewayThreadRuntimeInput = Omit<
  SeedGatewayThreadInput,
  "currentThread" | "threads" | "threadViews"
> & {
  currentThread: GatewayThread | null;
  threads: GatewayThread[];
  defaultHost: HostRecord;
  defaultProject: ProjectRecord;
  defaultHistory: ThreadHistoryState | null;
  threadViews?: Record<string, ThreadViewState>;
};

export async function seedGatewayThread(page: Page, input: SeedGatewayThreadInput) {
  const hostId = input.hostId ?? 1;
  const projectId = input.projectId ?? null;
  const threadId = input.threadId ?? null;
  const defaultHistory =
    input.threadId !== null && input.threadId !== undefined && input.threadId !== ""
      ? emptyThreadHistory(input.threadId)
      : null;
  const runtimeInput: SeedGatewayThreadRuntimeInput = {
    ...input,
    currentThread:
      input.currentThread === null
        ? null
        : gatewayThreadFixture(input.currentThread ?? { id: threadId ?? "e2e-thread" }, {
            hostId,
            projectId,
          }),
    threads: (input.threads ?? []).map((thread) =>
      gatewayThreadFixture(thread, { hostId, projectId }),
    ),
    defaultHost: defaultGatewayHost(hostId),
    defaultProject: defaultGatewayProject(hostId, input.projectId ?? 1),
    defaultHistory,
    threadViews: Object.fromEntries(
      Object.entries(input.threadViews ?? {}).map(([key, view]) => [
        key,
        {
          ...view,
          timelineTurns:
            view.timelineTurns ??
            (view.history === null ? [] : projectThreadTimelineHistory(view.history).thread.turns),
        },
      ]),
    ),
  };
  await page.evaluate((input: SeedGatewayThreadRuntimeInput) => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const { bootstrap, catalog, composer, navigation, runtime, views } = driver;
    const hostId = input.hostId ?? 1;
    const projectId = input.projectId ?? null;
    const threadId = input.threadId ?? null;
    catalog.hosts = [input.host ?? input.defaultHost];
    if (input.models !== undefined) {
      catalog.models = input.models;
      catalog.modelsHostId = hostId;
      catalog.loadingModels = false;
    }
    catalog.projects =
      input.project !== null && input.project !== undefined
        ? [input.project]
        : projectId !== null
          ? [input.defaultProject]
          : [];
    navigation.threads = input.threads ?? [];
    navigation.selectedHostId = hostId;
    navigation.selectedProjectId = projectId;
    navigation.selectedThreadId = threadId;
    const hasThread = threadId !== null && threadId !== "";
    views.currentThread = hasThread ? input.currentThread : null;
    views.setHistory(input.history ?? (hasThread ? input.defaultHistory : null));
    views.events = input.events ?? [];
    views.lastEventId = input.lastEventId ?? views.lastEventId;
    views.eventEpoch = input.eventEpoch ?? views.eventEpoch;
    views.olderTurnsCursor = input.olderTurnsCursor ?? null;
    views.newerTurnsCursor = input.newerTurnsCursor ?? null;
    views.threadViews = { ...views.threadViews, ...input.threadViews };
    bootstrap.initializing = false;
    views.loading = input.loading ?? false;
    if (hasThread && input.status !== undefined) {
      runtime.setThreadStatus(hostId, threadId, input.status);
    }
    if (hasThread && input.threadSettings !== undefined) {
      composer.setThreadSettings(hostId, threadId, input.threadSettings);
    }
    if (hasThread && input.tokenUsage !== undefined) {
      runtime.setThreadTokenUsage(hostId, threadId, input.tokenUsage);
    }
  }, runtimeInput);
}

export async function installRealtimeThreadSnapshotMock(
  page: Page,
  input: MockThreadSnapshotInput,
) {
  await installRealtimeThreadSnapshotRoute(page, input);
}

export async function threadActivateRequests(page: Page) {
  return realtimeThreadActivateRequests(page);
}

export async function appendAgentStreamLines(
  page: Page,
  input: { itemId: string; prefix: string; count: number },
) {
  await page.evaluate((input) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    const history = views.history;
    if (!history) throw new Error("Gateway thread history is unavailable");
    const turns = history.thread.turns;
    const agent = turns
      .flatMap((turn) => turn.items ?? [])
      .find((item) => item.id === input.itemId);
    if (agent === undefined || typeof agent.text !== "string") {
      throw new Error(`Missing Agent stream item ${input.itemId}`);
    }
    agent.text +=
      "\n\n" +
      Array.from(
        { length: input.count },
        (_, index) => `${input.prefix} ${String(index + 1).padStart(3, "0")}`,
      ).join("\n\n");
    views.setHistory({
      thread: { ...history.thread, turns: [...history.thread.turns] },
    });
  }, input);
}

export async function appendAgentTimelineItem(
  page: Page,
  input: { turnId: string; itemId: string; text: string },
) {
  await page.evaluate((input) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    const history = views.history;
    if (!history) throw new Error("Gateway thread history is unavailable");
    const turn = history.thread.turns.find((candidate) => candidate.id === input.turnId);
    if (!turn) throw new Error(`Missing turn ${input.turnId}`);
    turn.items = [
      ...(turn.items ?? []),
      {
        id: input.itemId,
        type: "agentMessage",
        status: "inProgress",
        text: input.text,
      },
    ];
    views.setHistory({
      thread: { ...history.thread, turns: [...history.thread.turns] },
    });
  }, input);
}

export async function appendFileDiffLines(
  page: Page,
  input: { itemId: string; path: string; prefix: string; count: number },
) {
  await page.evaluate((input) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    const history = views.history;
    const turn = history?.thread.turns[0];
    if (!history || !turn) throw new Error("Gateway thread history is unavailable");
    const fileChange = (turn.items ?? []).find((item) => item.id === input.itemId);
    const change = fileChange?.changes?.find((candidate) => candidate.path === input.path);
    if (change === undefined || typeof change.diff !== "string") {
      throw new Error(`Missing file change ${input.itemId}:${input.path}`);
    }
    change.diff +=
      "\n" +
      Array.from(
        { length: input.count },
        (_, index) => `+${input.prefix} ${String(index + 1).padStart(3, "0")}`,
      ).join("\n");
    views.setHistory({
      thread: { ...history.thread, turns: [...history.thread.turns] },
    });
  }, input);
}

export async function appendCommandOutputLines(
  page: Page,
  input: { itemId: string; prefix: string; count: number },
) {
  await page.evaluate((input) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    const history = views.history;
    const turn = history?.thread.turns[0];
    if (!history || !turn) throw new Error("Gateway thread history is unavailable");
    const command = (turn.items ?? []).find((item) => item.id === input.itemId);
    if (command === undefined || typeof command.aggregatedOutput !== "string") {
      throw new Error(`Missing command item ${input.itemId}`);
    }
    command.aggregatedOutput +=
      "\n" +
      Array.from(
        { length: input.count },
        (_, index) => `${input.prefix} ${String(index + 1).padStart(3, "0")}`,
      ).join("\n");
    views.setHistory({
      thread: { ...history.thread, turns: [...history.thread.turns] },
    });
  }, input);
}

export async function completeTurnWithFinalAgentMessage(
  page: Page,
  input: {
    agentItemId: string;
    finalItemId: string;
    finalText: string;
  },
) {
  await page.evaluate((input) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    const history = views.history;
    const turn = history?.thread.turns[0];
    if (!history || !turn) throw new Error("Gateway thread history is unavailable");
    turn.status = "completed";
    const items = turn.items ?? [];
    const agent = items.find((item) => item.id === input.agentItemId);
    if (agent === undefined) throw new Error(`Missing Agent item ${input.agentItemId}`);
    agent.status = "completed";
    items.push({
      id: input.finalItemId,
      type: "agentMessage",
      phase: "final_answer",
      status: "completed",
      text: input.finalText,
    });
    turn.items = items;
    views.setHistory({
      thread: { ...history.thread, turns: [...history.thread.turns] },
    });
  }, input);
}

export async function applyGatewayLiveEvent(page: Page, event: GatewayEvent) {
  await page.evaluate((event) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    views.applyLiveEvent(event);
  }, event);
}

export async function replayGatewayLiveEvents(page: Page, events: GatewayEvent[]) {
  await page.evaluate((events) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    for (const event of events) {
      views.applyLiveEvent(event);
    }
  }, events);
}

export async function receiveRealtimeThreadEvent(page: Page, event: GatewayEvent) {
  await page.evaluate((event) => {
    const realtime = window.__codexGatewayE2e?.realtime;
    if (!realtime) throw new Error("Gateway E2E driver is unavailable");
    realtime.receiveServerMessage({
      type: "thread.event",
      event,
    });
  }, event);
}

export async function openThreadInStore(
  page: Page,
  input: { threadId: string; hostId: number; projectId?: number | null },
) {
  await page.evaluate(async (input) => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Gateway E2E driver is unavailable");
    await views.openThread(input.threadId, {
      hostId: input.hostId,
      projectId: input.projectId ?? null,
    });
  }, input);
}

export async function selectedThreadStatusInStore(page: Page) {
  return page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const { navigation, runtime } = driver;
    if (
      navigation.selectedHostId === null ||
      navigation.selectedThreadId === null ||
      navigation.selectedThreadId === ""
    ) {
      return "idle";
    }
    return runtime.statusFor(navigation.selectedHostId, navigation.selectedThreadId);
  });
}

export async function cacheSelectedThreadAndOpenThread(
  page: Page,
  input: {
    threadId: string;
    hostId: number;
    projectId?: number | null;
    otherThreadId: string;
    otherThreadName: string;
  },
) {
  const otherThread = gatewayThreadFixture(
    { id: input.otherThreadId, name: input.otherThreadName },
    { hostId: input.hostId, projectId: input.projectId ?? null },
  );
  await page.evaluate(
    async ({ input, otherThread }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const { navigation, views } = driver;
      views.cacheSelectedThreadView();
      navigation.selectedThreadId = input.otherThreadId;
      views.currentThread = otherThread;
      views.setHistory({ thread: { id: input.otherThreadId, turns: [] } });
      await views.openThread(input.threadId, {
        hostId: input.hostId,
        projectId: input.projectId ?? null,
      });
    },
    { input, otherThread },
  );
}

export async function setThreadViewHistoryAndStatus(
  page: Page,
  input: {
    hostId: number;
    threadId: string;
    history: ThreadHistoryState;
    status?: "idle" | "running" | "completed" | "failed" | "interrupted";
    turnId?: string | null;
  },
) {
  const currentThread = gatewayThreadFixture(
    { id: input.threadId },
    { hostId: input.hostId, projectId: null },
  );
  const timelineTurns = projectThreadTimelineHistory(input.history).thread.turns;
  await page.evaluate(
    ({ input, currentThread, timelineTurns }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const { runtime, views } = driver;
      const key = `${input.hostId}:${input.threadId}`;
      const previous = views.threadViews[key];
      views.threadViews[key] = {
        hostId: input.hostId,
        projectId: previous?.projectId ?? null,
        threadId: input.threadId,
        currentThread: previous?.currentThread ?? currentThread,
        history: input.history,
        timelineTurns,
        events: previous?.events ?? [],
        olderTurnsCursor: previous?.olderTurnsCursor ?? null,
        newerTurnsCursor: previous?.newerTurnsCursor ?? null,
        lastEventId: previous?.lastEventId ?? 0,
        eventEpoch: previous?.eventEpoch ?? "e2e-event-epoch",
        loading: previous?.loading ?? false,
        error: previous?.error ?? null,
      };
      if (input.status) {
        runtime.setThreadStatus(input.hostId, input.threadId, input.status, {
          turnId: input.turnId ?? null,
        });
      }
    },
    { input, currentThread, timelineTurns },
  );
}

export function subAgentRuntimeFlags(
  page: Page,
  input: { hostId: number; firstThreadId: string; secondThreadId: string },
) {
  return page.evaluate((input) => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const { realtime, views } = driver;
    const firstKey = `${input.hostId}:${input.firstThreadId}`;
    const secondKey = `${input.hostId}:${input.secondThreadId}`;
    return {
      view: Boolean(views.threadViews[firstKey]),
      secondView: Boolean(views.threadViews[secondKey]),
      subscribed: Boolean(realtime.threadSubscriptions[firstKey]),
      secondSubscribed: Boolean(realtime.threadSubscriptions[secondKey]),
    };
  }, input);
}

export async function setThreadCollaborationMode(
  page: Page,
  input: { hostId: number; threadId: string; mode: "default" | "plan" },
) {
  await page.evaluate((input) => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const key = `${input.hostId}:${input.threadId}`;
    const current = driver.composer.threadSettingsByKey[key] ?? {};
    const model =
      current.collaborationMode?.settings.model ??
      current.model ??
      driver.catalog.defaultModel?.model ??
      driver.catalog.defaultModel?.id;
    if (model === null || model === undefined || model === "") {
      throw new Error("A model is required to seed collaboration mode");
    }
    driver.composer.setThreadSettings(input.hostId, input.threadId, {
      collaborationMode: {
        mode: input.mode,
        settings: {
          model,
          reasoningEffort: current.effort ?? null,
          developerInstructions: null,
        },
      },
    });
  }, input);
}

export async function dismissPlanPrompt(
  page: Page,
  input: { hostId: number; threadId: string; planItemId: string },
) {
  await page.evaluate((input) => {
    const composer = window.__codexGatewayE2e?.composer;
    if (!composer) throw new Error("Gateway E2E driver is unavailable");
    composer.dismissPlanImplementationPrompt(input.hostId, input.threadId, input.planItemId);
  }, input);
}

export async function installSelectedThreadGoalSubmitMock(
  page: Page,
  input: { hostId: number; threadId: string },
) {
  await page.evaluate((input) => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const { composer, captures } = driver;
    captures.goalObjective = null;
    composer.setSelectedThreadGoal = async (objective: string) => {
      captures.goalObjective = objective;
      composer.upsertThreadGoal(
        input.hostId,
        input.threadId,
        {
          threadId: input.threadId,
          objective,
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        { showInTimeline: true },
      );
    };
  }, input);
}

export async function installSelectedThreadGoalControlMock(
  page: Page,
  input: { hostId: number; threadId: string },
) {
  await page.evaluate((input) => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const { composer, captures } = driver;
    captures.goalControls = [];
    composer.setSelectedThreadGoalStatus = async (status: ThreadGoalStatus) => {
      captures.goalControls.push({ type: "status", status });
      composer.upsertThreadGoal(input.hostId, input.threadId, {
        threadId: input.threadId,
        objective: composer.selectedThreadGoal?.objective ?? "existing goal",
        status,
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    };
    composer.clearSelectedThreadGoal = async () => {
      captures.goalControls.push({ type: "clear" });
      composer.clearThreadGoalState(input.hostId, input.threadId);
    };
  }, input);
}

export async function installServerRequestResponderMock(
  page: Page,
  input: { mode: "capture" } | { mode: "fail"; message: string },
) {
  installRealtimeServerRequestResponseRoute(page, input);
}

export function capturedServerRequestResponse(page: Page) {
  return realtimeServerRequestResponse(page);
}

export async function installRealtimeInterruptMock(
  page: Page,
  input: { passThroughNonInterrupt?: boolean } = {},
) {
  // The shared Playwright route already dispatches all supported protocol messages, so non-
  // interrupt traffic remains available without forwarding through a replaced browser socket.
  void input.passThroughNonInterrupt;
  installRealtimeInterruptRoute(page);
}

export function capturedRealtimeInterrupt(page: Page) {
  return realtimeInterruptRequest(page);
}

export async function interruptActiveTurnInStore(page: Page) {
  await page.evaluate(async () => {
    const store = window.__codexGatewayE2e?.turns;
    if (!store) throw new Error("Gateway E2E driver is unavailable");
    await store.interruptActiveTurn();
  });
}
