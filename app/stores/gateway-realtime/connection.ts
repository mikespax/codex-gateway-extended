import { useEventListener } from "@vueuse/core";
import type { RealtimeClientMessage, RealtimeServerMessage } from "~~/shared/types";
import { useAuthStore } from "@/stores/auth";
import { createUuid } from "@/lib/uuid";
import { parseRealtimeServerMessage } from "~~/shared/runtime/realtime";

const RESUME_PING_TIMEOUT_MS = 4_000;
const HEALTHY_CONNECTION_CACHE_MS = 5_000;
const VISIBLE_HEALTH_INTERVAL_MS = 15_000;
const REALTIME_READY_TIMEOUT_MS = 15_000;

interface RealtimeConnectionOptions {
  disconnectedMessage: () => string;
  onMessage: (message: RealtimeServerMessage) => void;
  onDisconnected: (error: Error) => void;
}

interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
}

export interface RealtimeConnectionState {
  socket: WebSocket | null;
  connected: boolean;
  reconnectTimer: number | null;
  reconnectAttempt: number;
  generation: number;
  readyCount: number;
  healthTimer: number | null;
  healthNonce: string | null;
  healthListenersInstalled: boolean;
}

export function createRealtimeConnection(options: RealtimeConnectionOptions) {
  const readyWaiters = new Set<ReadyWaiter>();
  let healthProbe: {
    nonce: string;
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  let lastHealthyAt = 0;
  const state = reactive<RealtimeConnectionState>({
    socket: null,
    connected: false,
    reconnectTimer: null as number | null,
    reconnectAttempt: 0,
    generation: 0,
    readyCount: 0,
    healthTimer: null as number | null,
    healthNonce: null as string | null,
    healthListenersInstalled: false,
  });

  function connect() {
    if (!import.meta.client) return;

    const auth = useAuthStore();
    auth.hydrate();
    if (!auth.isAuthenticated) return;

    const existing = state.socket;
    if (
      existing !== null &&
      (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    clearReconnectTimer();

    const generation = state.generation + 1;
    state.generation = generation;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
    state.socket = socket;

    socket.addEventListener("open", () => {
      if (state.generation !== generation) {
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: "auth.authenticate", token: auth.token }));
    });

    socket.addEventListener("message", (event) => {
      if (state.generation !== generation) return;
      try {
        options.onMessage(parseRealtimeServerMessage(JSON.parse(String(event.data))));
      } catch (error: unknown) {
        // A malformed or protocol-incompatible frame cannot be ignored while the socket remains
        // healthy: the request broker would wait until its deadline for a response already lost.
        console.error("[gateway] invalid realtime server frame", error);
        socket.close(1002, "Invalid realtime server frame");
      }
    });

    socket.addEventListener("close", () => {
      if (state.generation !== generation) return;
      clearHealthTimer();
      state.connected = false;
      state.socket = null;
      lastHealthyAt = 0;
      const healthError = new Error(options.disconnectedMessage());
      const pendingHealthProbe = healthProbe;
      healthProbe = null;
      pendingHealthProbe?.reject(healthError);
      options.onDisconnected(healthError);
      scheduleReconnect();
    });

    socket.addEventListener("error", () => socket.close());
  }

  function reconnectNow() {
    if (!import.meta.client) return;

    clearReconnectTimer();
    clearHealthTimer();
    rejectHealthProbe(new Error(options.disconnectedMessage()));
    lastHealthyAt = 0;
    closeCurrentSocket();
    options.onDisconnected(new Error(options.disconnectedMessage()));
    connect();
  }

  function reset() {
    if (!import.meta.client) return;

    clearReconnectTimer();
    clearHealthTimer();
    closeCurrentSocket();
    state.reconnectAttempt = 0;
    state.readyCount = 0;
    lastHealthyAt = 0;
    rejectHealthProbe(new Error(options.disconnectedMessage()));
    rejectReadyWaiters(new Error(options.disconnectedMessage()));
    options.onDisconnected(new Error(options.disconnectedMessage()));
  }

  function closeCurrentSocket() {
    const socket = state.socket;
    state.generation += 1;
    state.socket = null;
    state.connected = false;
    if (
      socket !== null &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close();
    }
  }

  function scheduleReconnect() {
    if (!import.meta.client || state.reconnectTimer !== null || !useAuthStore().isAuthenticated)
      return;

    const attempt = state.reconnectAttempt + 1;
    state.reconnectAttempt = attempt;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt - 1, 5));
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }

  function send(message: RealtimeClientMessage) {
    connect();
    const socket = state.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function installHealthCheck() {
    if (!import.meta.client || state.healthListenersInstalled) return;

    state.healthListenersInstalled = true;
    useEventListener(window, "focus", checkConnection);
    useEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") checkConnection();
    });
    window.setInterval(() => {
      if (document.visibilityState === "visible") checkConnection();
    }, VISIBLE_HEALTH_INTERVAL_MS);
  }

  function checkConnection() {
    void ensureHealthy().catch(() => {
      // The request path reports its own failure. A background heartbeat only repairs the
      // connection and must not create an unhandled rejection.
    });
  }

  async function ensureHealthy() {
    if (!import.meta.client || !useAuthStore().isAuthenticated) return;

    const socket = state.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN || !state.connected) {
      if (socket !== null || state.connected) reconnectNow();
      else connect();
      await waitForReady(REALTIME_READY_TIMEOUT_MS);
      return;
    }

    if (lastHealthyAt + HEALTHY_CONNECTION_CACHE_MS > Date.now()) return;
    if (healthProbe !== null) {
      await healthProbe.promise;
      return;
    }

    const nonce = createUuid();
    let resolveProbe!: () => void;
    let rejectProbe!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveProbe = resolve;
      rejectProbe = reject;
    });
    const currentProbe = {
      nonce,
      promise,
      resolve: resolveProbe,
      reject: rejectProbe,
    };
    healthProbe = currentProbe;
    clearHealthTimer();
    state.healthNonce = nonce;
    state.healthTimer = window.setTimeout(() => {
      if (healthProbe !== currentProbe) return;
      healthProbe = null;
      clearHealthTimer();
      lastHealthyAt = 0;
      // Do not send the application request until the replacement socket has completed auth.
      reconnectNow();
      void waitForReady(REALTIME_READY_TIMEOUT_MS).then(resolveProbe, rejectProbe);
    }, RESUME_PING_TIMEOUT_MS);
    try {
      socket.send(JSON.stringify({ type: "ping", nonce }));
    } catch {
      if (healthProbe === currentProbe) healthProbe = null;
      clearHealthTimer();
      lastHealthyAt = 0;
      reconnectNow();
      void waitForReady(REALTIME_READY_TIMEOUT_MS).then(resolveProbe, rejectProbe);
    }
    await promise;
  }

  function acknowledgePong(nonce?: string) {
    if (nonce !== undefined && nonce !== state.healthNonce) return;
    lastHealthyAt = Date.now();
    clearHealthTimer();
    const pendingHealthProbe = healthProbe;
    healthProbe = null;
    pendingHealthProbe?.resolve();
  }

  function markReady() {
    state.connected = true;
    state.reconnectAttempt = 0;
    state.readyCount += 1;
    resolveReadyWaiters();
  }

  function waitForReady(timeoutMs: number) {
    connect();
    if (state.connected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        timer: window.setTimeout(() => {
          readyWaiters.delete(waiter);
          reject(new Error(options.disconnectedMessage()));
        }, timeoutMs),
      };
      readyWaiters.add(waiter);
    });
  }

  function resolveReadyWaiters() {
    for (const waiter of readyWaiters) {
      window.clearTimeout(waiter.timer);
      waiter.resolve();
    }
    readyWaiters.clear();
  }

  function rejectReadyWaiters(error: Error) {
    for (const waiter of readyWaiters) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    readyWaiters.clear();
  }

  function clearReconnectTimer() {
    if (state.reconnectTimer === null) return;
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  function clearHealthTimer() {
    if (state.healthTimer !== null) {
      window.clearTimeout(state.healthTimer);
      state.healthTimer = null;
    }
    state.healthNonce = null;
  }

  function rejectHealthProbe(error: Error) {
    const pendingHealthProbe = healthProbe;
    healthProbe = null;
    pendingHealthProbe?.reject(error);
  }

  return {
    state,
    connect,
    reconnectNow,
    reset,
    scheduleReconnect,
    send,
    installHealthCheck,
    checkConnection,
    ensureHealthy,
    acknowledgePong,
    markReady,
    waitForReady,
  };
}
