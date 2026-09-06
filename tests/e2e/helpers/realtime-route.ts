import type { Page, WebSocketRoute } from "@playwright/test";
import type {
  GatewayEvent,
  ProjectRecord,
  RealtimeClientMessage,
  RealtimeServerMessage,
  ThreadHistoryState,
  ThreadSettingsState,
  ThreadTokenUsageState,
} from "../../../shared/types";
import { parseRealtimeClientMessage } from "../../../shared/runtime/realtime";
import { projectThreadTimelineHistory } from "../../../shared/thread-history/timeline";
import { gatewayThreadFixture, type GatewayThreadFixture } from "../fixtures/gateway-thread";

export interface MockThreadSnapshotInput {
  hostId?: number;
  responseDelayMs?: number;
  snapshots: Record<
    string,
    {
      thread?: GatewayThreadFixture;
      history?: ThreadHistoryState;
      projectId?: number | null;
      project?: ProjectRecord | null;
      threadSettings?: ThreadSettingsState;
      tokenUsage?: ThreadTokenUsageState | null;
      turnsPage?: { nextCursor: string | null; backwardsCursor: string | null };
      recentEvents?: GatewayEvent[];
      lastEventId?: number;
      eventEpoch?: string;
      runtimeStatus?: "idle" | "running" | "completed" | "failed" | "interrupted" | null;
    }
  >;
}

interface RealtimeRouteState {
  snapshots: MockThreadSnapshotInput | null;
  activateRequests: RealtimeClientMessage[];
  captureInterrupts: boolean;
  interruptRequest: Extract<RealtimeClientMessage, { type: "turn.interrupt" }> | null;
  serverRequestResponse: ServerRequestResponseRouteState | null;
  threadTurnsLoad: ThreadTurnsLoadRouteState | null;
  turnStart: TurnStartRouteState | null;
}

interface RealtimeRouteConnection {
  route: WebSocketRoute;
  upstream: WebSocketRoute;
}

type ServerRequestResponseRouteState =
  | {
      mode: "capture";
      request: Extract<RealtimeClientMessage, { type: "serverRequest.respond" }> | null;
    }
  | { mode: "fail"; message: string };

interface ThreadTurnsLoadRouteState {
  deferred: boolean;
  requests: Array<{
    connection: RealtimeRouteConnection;
    message: Extract<RealtimeClientMessage, { type: "thread.turns.load" }>;
  }>;
  response: Extract<RealtimeServerMessage, { type: "thread.turns.page" }>;
}

interface TurnStartRouteState {
  requests: Array<{
    connection: RealtimeRouteConnection;
    message: Extract<RealtimeClientMessage, { type: "turn.start" }>;
  }>;
  turn: unknown;
}

type ThreadTurnsLoadResponseInput = Omit<
  Extract<RealtimeServerMessage, { type: "thread.turns.page" }>,
  "history"
> & { history: ThreadHistoryState };

const routes = new WeakMap<Page, RealtimeRouteState>();

export async function installRealtimeRoute(page: Page) {
  if (routes.has(page)) return;

  const state: RealtimeRouteState = {
    snapshots: null,
    activateRequests: [],
    captureInterrupts: false,
    interruptRequest: null,
    serverRequestResponse: null,
    threadTurnsLoad: null,
    turnStart: null,
  };
  routes.set(page, state);
  await page.routeWebSocket(/\/api\/realtime$/, (route) => {
    const connection = { route, upstream: route.connectToServer() };
    route.onMessage((raw) => handleClientMessage(state, connection, raw));
  });
}

export async function installRealtimeThreadSnapshotRoute(
  page: Page,
  input: MockThreadSnapshotInput,
) {
  const state = requireRealtimeRoute(page);
  state.snapshots = input;
  state.activateRequests = [];
}

export function installRealtimeInterruptRoute(page: Page) {
  const state = requireRealtimeRoute(page);
  state.captureInterrupts = true;
  state.interruptRequest = null;
}

export function installRealtimeServerRequestResponseRoute(
  page: Page,
  input: { mode: "capture" } | { mode: "fail"; message: string },
) {
  const state = requireRealtimeRoute(page);
  state.serverRequestResponse =
    input.mode === "capture" ? { mode: "capture", request: null } : input;
}

export function realtimeServerRequestResponse(page: Page) {
  const route = routes.get(page)?.serverRequestResponse;
  return route?.mode === "capture" ? route.request : null;
}

export function realtimeInterruptRequest(page: Page) {
  return routes.get(page)?.interruptRequest ?? null;
}

export function installRealtimeThreadTurnsLoadRoute(
  page: Page,
  response: ThreadTurnsLoadResponseInput,
  deferred: boolean,
) {
  const state = requireRealtimeRoute(page);
  state.threadTurnsLoad = {
    deferred,
    requests: [],
    response: { ...response, history: projectThreadTimelineHistory(response.history) },
  };
}

export function releaseRealtimeThreadTurnsLoadRoute(page: Page) {
  const state = requireRealtimeRoute(page);
  const route = state.threadTurnsLoad;
  if (route === null) throw new Error("No deferred thread turns route is installed");
  for (const request of route.requests) {
    sendThreadTurnsPage(request.connection, route.response, request.message);
  }
  route.deferred = false;
}

export function realtimeThreadTurnsLoadRequests(page: Page) {
  return (routes.get(page)?.threadTurnsLoad?.requests ?? []).map(({ message }) => message);
}

export function installDeferredRealtimeTurnStartRoute(page: Page, turn: unknown) {
  const state = requireRealtimeRoute(page);
  state.turnStart = { requests: [], turn };
}

export function deferredRealtimeTurnStartRequests(page: Page) {
  return (routes.get(page)?.turnStart?.requests ?? []).map(({ message }) => message);
}

export function releaseDeferredRealtimeTurnStartRoute(page: Page) {
  const state = requireRealtimeRoute(page);
  const route = state.turnStart;
  if (route === null) throw new Error("No deferred turn start route is installed");
  for (const request of route.requests) {
    send(request.connection, {
      type: "turn.start.accepted",
      requestId: request.message.requestId,
      hostId: request.message.hostId,
      threadId: request.message.threadId,
      turn: route.turn,
    });
  }
  route.requests = [];
}

export function realtimeThreadActivateRequests(page: Page) {
  return [...(routes.get(page)?.activateRequests ?? [])];
}

function requireRealtimeRoute(page: Page) {
  const state = routes.get(page);
  if (!state) throw new Error("Install the realtime route before navigating with openApp");
  return state;
}

function handleClientMessage(
  state: RealtimeRouteState,
  connection: RealtimeRouteConnection,
  raw: string | Buffer,
) {
  const message = parseRealtimeClientMessage(JSON.parse(raw.toString()));
  if (message.type === "thread.activate" && state.snapshots !== null) {
    handleThreadActivate(state, connection, message);
    return;
  }
  if (message.type === "turn.interrupt" && state.captureInterrupts) {
    handleTurnInterrupt(state, connection, message);
    return;
  }
  if (message.type === "serverRequest.respond" && state.serverRequestResponse !== null) {
    handleServerRequestResponse(connection, state.serverRequestResponse, message);
    return;
  }
  if (isThreadTurnsLoad(message) && state.threadTurnsLoad !== null) {
    state.threadTurnsLoad.requests.push({ connection, message });
    if (!state.threadTurnsLoad.deferred)
      sendThreadTurnsPage(connection, state.threadTurnsLoad.response, message);
    return;
  }
  if (message.type === "turn.start" && state.turnStart !== null) {
    state.turnStart.requests.push({ connection, message });
    return;
  }
  connection.upstream.send(raw);
}

function isThreadTurnsLoad(
  message: RealtimeClientMessage,
): message is Extract<RealtimeClientMessage, { type: "thread.turns.load" }> {
  return message.type === "thread.turns.load";
}

function sendThreadTurnsPage(
  connection: RealtimeRouteConnection,
  response: Extract<RealtimeServerMessage, { type: "thread.turns.page" }>,
  request: Extract<RealtimeClientMessage, { type: "thread.turns.load" }>,
) {
  send(connection, {
    ...response,
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
  });
}

function handleThreadActivate(
  state: RealtimeRouteState,
  connection: RealtimeRouteConnection,
  message: Extract<RealtimeClientMessage, { type: "thread.activate" }>,
) {
  state.activateRequests.push(message);
  const input = state.snapshots;
  const snapshot = input?.snapshots[message.threadId];
  if (!snapshot) {
    throw new Error(`Missing mocked thread snapshot for ${message.threadId}`);
  }
  const respond = () => {
    const thread = gatewayThreadFixture(snapshot.thread ?? { id: message.threadId }, {
      hostId: message.hostId ?? input.hostId ?? 1,
      projectId: snapshot.projectId ?? null,
    });
    send(connection, {
      type: "thread.snapshot",
      requestId: message.requestId,
      hostId: message.hostId ?? input.hostId ?? 1,
      threadId: message.threadId,
      thread,
      history: projectThreadTimelineHistory(
        snapshot.history ?? { thread: { id: message.threadId, turns: [] } },
      ),
      runtimeStatus: snapshot.runtimeStatus ?? null,
      projectId: snapshot.projectId ?? null,
      project: snapshot.project ?? null,
      threadSettings: snapshot.threadSettings ?? {},
      tokenUsage: snapshot.tokenUsage ?? null,
      turnsPage: snapshot.turnsPage ?? { nextCursor: null, backwardsCursor: null },
      recentEvents: snapshot.recentEvents ?? [],
      lastEventId: snapshot.lastEventId ?? 0,
      eventEpoch: snapshot.eventEpoch ?? "e2e-event-epoch",
    });
  };
  if (input.responseDelayMs !== undefined && input.responseDelayMs > 0) {
    setTimeout(respond, input.responseDelayMs);
  } else respond();
}

function handleTurnInterrupt(
  state: RealtimeRouteState,
  connection: RealtimeRouteConnection,
  message: Extract<RealtimeClientMessage, { type: "turn.interrupt" }>,
) {
  state.interruptRequest = message;
  send(connection, {
    type: "turn.interrupt.accepted",
    requestId: message.requestId,
    hostId: message.hostId,
    threadId: message.threadId,
  });
}

function handleServerRequestResponse(
  connection: RealtimeRouteConnection,
  route: ServerRequestResponseRouteState,
  message: Extract<RealtimeClientMessage, { type: "serverRequest.respond" }>,
) {
  if (route.mode === "fail") {
    send(connection, {
      type: "error",
      requestId: message.requestId,
      request: message,
      message: route.message,
    });
    return;
  }
  route.request = message;
  send(connection, {
    type: "serverRequest.respond.accepted",
    requestId: message.requestId,
    hostId: message.hostId,
    threadId: message.threadId,
    serverRequestId: message.serverRequestId,
  });
}

function send(connection: RealtimeRouteConnection, message: RealtimeServerMessage) {
  connection.route.send(JSON.stringify(message));
}
