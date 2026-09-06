import type { HostRecord, RpcEnvelope } from "~~/shared/types";
import { buildCurrentTimeReadResponse, isCurrentTimeReadRequest } from "~~/shared/server-requests";
import { CodexRpcClient } from "../infra/rpc/rpc";
import { bindGatewayUser } from "../state/memory";
import type { HostControllerLookup, HostControllersLookup } from "./types";
import { threadIdFromNotification } from "../protocol/thread-payload";
import { threadRuntimeEvents } from "./thread-runtime-events";
import { activeMainThreadMonitor } from "./active-main-thread-monitor";
import { codexRuntime } from "../infra/host-services";
import { runtimeLog } from "./runtime-log";
import { createThreadNotificationResolvers } from "./notification-rpc-resolvers";
import { pendingServerRequests } from "./pending-server-requests";

export class HostRpcSession {
  readonly client: CodexRpcClient;
  private connected = false;
  private connectPromise: Promise<CodexRpcClient> | null = null;
  private generation = 0;

  constructor(
    readonly host: HostRecord,
    private readonly controllerForThread: HostControllerLookup,
    private readonly controllersForHost: HostControllersLookup,
    private readonly onClose?: () => void,
  ) {
    this.client = new CodexRpcClient(host);
    this.client.on(
      "notification",
      bindGatewayUser((message: RpcEnvelope) => this.routeNotification(message)),
    );
    this.client.on(
      "request",
      bindGatewayUser((message: RpcEnvelope) => this.routeRequest(message)),
    );
    this.client.on(
      "stderr",
      bindGatewayUser((text: string) => this.routeStderr(text)),
    );
    this.client.on(
      "close",
      bindGatewayUser(() => {
        this.connected = false;
        this.onClose?.();
      }),
    );
  }

  async connect() {
    if (this.connected) {
      return this.client;
    }
    if (this.connectPromise === null) {
      const generation = this.generation;
      const pending = this.client
        .connect()
        .then(() => {
          if (generation !== this.generation) {
            throw new Error("Host RPC session connection was superseded");
          }
          this.connected = true;
          return this.client;
        })
        .finally(() => {
          if (this.connectPromise === pending) this.connectPromise = null;
        });
      this.connectPromise = pending;
    }
    return this.connectPromise;
  }

  private routeNotification(message: RpcEnvelope) {
    activeMainThreadMonitor.handleNotification(
      {
        host: this.host,
        client: this.client,
        hasController: (threadId) => this.controllerForThread(this.host.id, threadId) !== null,
      },
      message,
    );
    if (message?.method === "turn/completed" && this.client.hasDeferredUpgrade()) {
      void codexRuntime
        .completeDeferredUpgrade(this.host)
        .then((stopped) => {
          if (stopped === true) this.client.resolveDeferredUpgrade();
        })
        .catch((error) => {
          runtimeLog("deferred Codex upgrade check failed", {
            hostId: this.host.id,
            hostName: this.host.name,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
    const threadId = threadIdFromNotification(message);
    if (threadId === null) {
      return;
    }
    pendingServerRequests.resolveFromNotification(this.host.id, threadId, message);
    const controller = this.controllerForThread(this.host.id, threadId);
    if (controller !== null) {
      controller.handleNotification(message);
    } else {
      threadRuntimeEvents.record(
        this.host.id,
        threadId,
        message.method ?? "notification",
        message,
        createThreadNotificationResolvers(this.client, threadId),
      );
    }
  }

  private routeRequest(message: RpcEnvelope) {
    if (isCurrentTimeReadRequest(message)) {
      if (message.id !== null && message.id !== undefined) {
        this.client.respond(message.id, buildCurrentTimeReadResponse());
      }
      return;
    }

    const threadId = threadIdFromNotification(message);
    if (threadId === null) {
      threadRuntimeEvents.record(this.host.id, "gateway", message.method ?? "request", message);
      return;
    }
    pendingServerRequests.track(this.host.id, threadId, message);
    const controller = this.controllerForThread(this.host.id, threadId);
    if (controller !== null) {
      controller.handleNotification(message);
    } else {
      threadRuntimeEvents.record(
        this.host.id,
        threadId,
        message.method ?? "request",
        message,
        createThreadNotificationResolvers(this.client, threadId),
      );
    }
  }

  private routeStderr(text: string) {
    for (const controller of this.controllersForHost(this.host.id)) {
      controller.handleStderr(text);
    }
  }

  close() {
    this.generation += 1;
    this.connected = false;
    this.connectPromise = null;
    this.client.close();
  }
}
