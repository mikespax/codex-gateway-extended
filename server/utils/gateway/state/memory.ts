import type {
  GatewayConfig,
  GatewayEvent,
  AppServerThreadStatus,
  HostRecord,
  PinnedThreadRecord,
  ProjectRecord,
} from "~~/shared/types";
import { normalizeNotificationSettings } from "~~/shared/config";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ThreadOpenSnapshot } from "../runtime/types";

// Gateway cursors are process-local but remain numerically monotonic across normal restarts. A
// browser cursor from an older process is therefore either below every new event (and replays all
// of them) or above an empty store (and triggers an explicit gap), never in the middle of a reused
// 1..N range. Multiplying milliseconds leaves room for sustained event bursts within this process.
const PROCESS_EVENT_ID_BASE = Date.now() * 1_000;

export type StoredHostRecord = HostRecord;

export interface ThreadMetadataRecord {
  hostId: number;
  projectId: number | null;
  threadId: string;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  title: string | null;
  name: string | null;
  preview: string | null;
  cwd: string | null;
  status: AppServerThreadStatus;
  recencyAt: number | null;
  updatedAt: number;
}

export interface ThreadSnapshotRecord {
  hostId: number;
  threadId: string;
  snapshot: ThreadOpenSnapshot;
  updatedAt: string;
}

export interface SubAgentThreadRecord {
  hostId: number;
  threadId: string;
  parentThreadId: string | null;
  updatedAt: string;
}

export interface GatewayMemoryState {
  hosts: StoredHostRecord[];
  projects: ProjectRecord[];
  configuredProjectIds: Set<number>;
  pinnedThreads: PinnedThreadRecord[];
  notifications: GatewayConfig["notifications"];
  threadMetadata: ThreadMetadataRecord[];
  threadSnapshots: ThreadSnapshotRecord[];
  subAgentThreads: SubAgentThreadRecord[];
  events: GatewayEvent[];
  eventPrunedThroughByThread: Record<string, number>;
  eventEpochByHost: Record<string, string>;
  nextEventId: number;
  publishedNotificationKeys: string[];
  deliveredNotificationKeys: string[];
  pendingNotificationKeys: string[];
  configLoaded: boolean;
}

// These names shipped briefly in the host picker UI. Keep the display migration at the durable
// configuration boundary as well as the write paths, otherwise a process restart can rehydrate
// the old labels before a browser has a chance to submit a new configuration.
function canonicalHostName(name: string) {
  switch (name) {
    case "Mac Pro — compute":
      return "Mac";
    case "Lenovo — compute":
      return "Lenovo";
    default:
      return name;
  }
}

function createGatewayMemoryState(): GatewayMemoryState {
  return {
    hosts: [],
    projects: [],
    configuredProjectIds: new Set(),
    pinnedThreads: [],
    notifications: normalizeNotificationSettings(),
    threadMetadata: [],
    threadSnapshots: [],
    subAgentThreads: [],
    events: [],
    eventPrunedThroughByThread: {},
    eventEpochByHost: {},
    nextEventId: PROCESS_EVENT_ID_BASE,
    publishedNotificationKeys: [],
    deliveredNotificationKeys: [],
    pendingNotificationKeys: [],
    configLoaded: false,
  };
}

const anonymousState = createGatewayMemoryState();
const statesByUser = new Map<number, GatewayMemoryState>();
const userScope = new AsyncLocalStorage<number>();

// Keep the existing property API while making the AsyncLocalStorage boundary fully typed.
// A Proxy would make every indexed write `unknown`; explicit accessors let TypeScript verify
// each field and still resolve the state for the current user at access time.
export const gatewayMemoryState: GatewayMemoryState = {
  get hosts() {
    return currentGatewayMemoryState().hosts;
  },
  set hosts(value) {
    currentGatewayMemoryState().hosts = value;
  },
  get projects() {
    return currentGatewayMemoryState().projects;
  },
  set projects(value) {
    currentGatewayMemoryState().projects = value;
  },
  get configuredProjectIds() {
    return currentGatewayMemoryState().configuredProjectIds;
  },
  set configuredProjectIds(value) {
    currentGatewayMemoryState().configuredProjectIds = value;
  },
  get pinnedThreads() {
    return currentGatewayMemoryState().pinnedThreads;
  },
  set pinnedThreads(value) {
    currentGatewayMemoryState().pinnedThreads = value;
  },
  get notifications() {
    return currentGatewayMemoryState().notifications;
  },
  set notifications(value) {
    currentGatewayMemoryState().notifications = value;
  },
  get threadMetadata() {
    return currentGatewayMemoryState().threadMetadata;
  },
  set threadMetadata(value) {
    currentGatewayMemoryState().threadMetadata = value;
  },
  get threadSnapshots() {
    return currentGatewayMemoryState().threadSnapshots;
  },
  set threadSnapshots(value) {
    currentGatewayMemoryState().threadSnapshots = value;
  },
  get subAgentThreads() {
    return currentGatewayMemoryState().subAgentThreads;
  },
  set subAgentThreads(value) {
    currentGatewayMemoryState().subAgentThreads = value;
  },
  get events() {
    return currentGatewayMemoryState().events;
  },
  set events(value) {
    currentGatewayMemoryState().events = value;
  },
  get eventPrunedThroughByThread() {
    return currentGatewayMemoryState().eventPrunedThroughByThread;
  },
  set eventPrunedThroughByThread(value) {
    currentGatewayMemoryState().eventPrunedThroughByThread = value;
  },
  get eventEpochByHost() {
    return currentGatewayMemoryState().eventEpochByHost;
  },
  set eventEpochByHost(value) {
    currentGatewayMemoryState().eventEpochByHost = value;
  },
  get nextEventId() {
    return currentGatewayMemoryState().nextEventId;
  },
  set nextEventId(value) {
    currentGatewayMemoryState().nextEventId = value;
  },
  get publishedNotificationKeys() {
    return currentGatewayMemoryState().publishedNotificationKeys;
  },
  set publishedNotificationKeys(value) {
    currentGatewayMemoryState().publishedNotificationKeys = value;
  },
  get deliveredNotificationKeys() {
    return currentGatewayMemoryState().deliveredNotificationKeys;
  },
  set deliveredNotificationKeys(value) {
    currentGatewayMemoryState().deliveredNotificationKeys = value;
  },
  get pendingNotificationKeys() {
    return currentGatewayMemoryState().pendingNotificationKeys;
  },
  set pendingNotificationKeys(value) {
    currentGatewayMemoryState().pendingNotificationKeys = value;
  },
  get configLoaded() {
    return currentGatewayMemoryState().configLoaded;
  },
  set configLoaded(value) {
    currentGatewayMemoryState().configLoaded = value;
  },
};

export function currentGatewayUserId() {
  return userScope.getStore() ?? null;
}

export function currentGatewayMemoryState() {
  const userId = currentGatewayUserId();
  if (userId === null) {
    return anonymousState;
  }
  let state = statesByUser.get(userId);
  if (state === undefined) {
    state = createGatewayMemoryState();
    statesByUser.set(userId, state);
  }
  return state;
}

export function replaceCurrentGatewayMemoryState(nextState: GatewayMemoryState) {
  const userId = currentGatewayUserId();
  if (userId === null) {
    Object.assign(anonymousState, nextState);
    return;
  }
  statesByUser.set(userId, nextState);
}

export function runWithGatewayUser<T>(userId: number, callback: () => T): T {
  return userScope.run(userId, callback);
}

export function bindGatewayUser<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const userId = currentGatewayUserId();
  if (userId === null) {
    return callback;
  }
  return (...args: Args) => runWithGatewayUser(userId, () => callback(...args));
}

export function buildGatewayMemoryState(config: GatewayConfig): GatewayMemoryState {
  return {
    ...createGatewayMemoryState(),
    hosts: config.hosts.map((host) => ({
      ...host,
      name: canonicalHostName(host.name),
      proxyUrl: trimmedOrNull(host.proxyUrl),
      hasPassword: typeof host.password === "string" && host.password.length > 0,
    })),
    projects: (config.projects ?? []).map((project) => ({
      ...project,
      name: project.name.trim(),
      remotePath: project.remotePath.trim(),
    })),
    configuredProjectIds: new Set((config.projects ?? []).map((project) => project.id)),
    pinnedThreads: normalizePinnedThreads(config.pinnedThreads ?? []),
    notifications: normalizeNotificationSettings(config.notifications),
  };
}

export const initialGatewayMemoryState: GatewayMemoryState = {
  hosts: [],
  projects: [],
  configuredProjectIds: new Set(),
  pinnedThreads: [],
  notifications: normalizeNotificationSettings(),
  threadMetadata: [],
  threadSnapshots: [],
  subAgentThreads: [],
  events: [],
  eventPrunedThroughByThread: {},
  eventEpochByHost: {},
  nextEventId: 1,
  publishedNotificationKeys: [],
  deliveredNotificationKeys: [],
  pendingNotificationKeys: [],
  configLoaded: false,
};

export function normalizePinnedThreads(threads: PinnedThreadRecord[]) {
  return threads.map((thread) => ({
    hostId: thread.hostId,
    projectId: thread.projectId ?? null,
    threadId: thread.threadId.trim(),
    title: thread.title.trim(),
    subtitle: trimmedOrNull(thread.subtitle),
    projectName: trimmedOrNull(thread.projectName),
    updatedAt: thread.updatedAt ?? null,
    inactive: thread.inactive === true,
  }));
}

export function nowIso() {
  return new Date().toISOString();
}

export function nextId(records: Array<{ id: number }>) {
  return records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
}

export function toTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return null;
}
