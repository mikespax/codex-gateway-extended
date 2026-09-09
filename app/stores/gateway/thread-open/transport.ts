import type { ComposerTurnOptions } from "~~/shared/types";
import { INITIAL_TURN_PAGE_LIMIT, MAX_TURN_PAGE_LIMIT } from "~~/shared/config";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import {
  expectThreadSnapshot,
  expectThreadStarted,
} from "@/stores/gateway-realtime/response-parsers";

export type ThreadSnapshotMessage = Extract<
  import("~~/shared/types").RealtimeServerMessage,
  { type: "thread.snapshot" }
>;

export type ThreadStartedMessage = Extract<
  import("~~/shared/types").RealtimeServerMessage,
  { type: "thread.started" }
>;

export function requestActivateThreadSnapshot(input: {
  hostId: number;
  projectId: number | null;
  threadId: string;
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const requestedLimit = Number.isFinite(input.limit)
    ? Math.trunc(input.limit ?? INITIAL_TURN_PAGE_LIMIT)
    : INITIAL_TURN_PAGE_LIMIT;
  const limit = Math.min(MAX_TURN_PAGE_LIMIT, Math.max(INITIAL_TURN_PAGE_LIMIT, requestedLimit));
  return useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "thread.activate",
      requestId,
      hostId: input.hostId,
      projectId: input.projectId,
      cwd: projectById(useGatewayCatalogStore().projects, input.projectId)?.remotePath,
      threadId: input.threadId,
      limit,
    }),
    expectThreadSnapshot,
    {
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    },
  );
}

export function requestStartThread(options: ComposerTurnOptions) {
  const gateway = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const hostId = navigation.selectedHostId;
  if (hostId === null) throw new Error("Host is required to start a thread");
  return useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "thread.start",
      requestId,
      hostId,
      projectId: navigation.selectedProjectId,
      cwd: projectById(gateway.projects, navigation.selectedProjectId)?.remotePath,
      model: options.model === "" ? undefined : options.model,
      effort: options.effort === "" ? undefined : options.effort,
      serviceTier: options.serviceTier === "" ? undefined : options.serviceTier,
      approvalPolicy: options.approvalPolicy ?? undefined,
    }),
    expectThreadStarted,
    { timeoutMs: 30_000 },
  );
}
