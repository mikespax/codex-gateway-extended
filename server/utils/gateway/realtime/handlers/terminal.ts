import type { RealtimeClientMessage } from "~~/shared/types";
import { firstNonEmptyString, trimmedOrNull } from "~~/shared/utils/strings";
import { requireRecord } from "../../http/validation/common";
import { hostStore } from "../../state/hosts";
import { projectStore } from "../../state/projects";
import { threadMetadataStore } from "../../state/thread-metadata";
import { terminalEventBus } from "../../terminal/events";
import { terminalManager } from "../../terminal/terminal-manager";
import {
  authenticatedUserId,
  sendRealtimePeerMessage,
  stateFor,
  type RealtimePeer,
} from "../peer-state";

export async function openTerminal(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "terminal.open" }>,
) {
  const userId = authenticatedUserId(peer);
  const host = requireRecord(hostStore.getWithSecret(request.hostId), "Host not found");
  const target = {
    ...request,
    projectId: request.projectId ?? null,
    threadId: request.threadId ?? null,
    cwd: resolveTerminalCwd(request),
    title: trimmedOrNull(request.title) ?? terminalTitle(request),
  };
  const session = await terminalManager.open(userId, host, target);
  sendRealtimePeerMessage(peer, { type: "terminal.opened", requestId: request.requestId, session });
}

export function listTerminals(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "terminal.list" }>,
) {
  const userId = authenticatedUserId(peer);
  sendRealtimePeerMessage(peer, {
    type: "terminal.snapshot",
    requestId: request.requestId,
    sessions: terminalManager.list(userId),
  });
}

export function writeTerminalInput(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "terminal.input" }>,
) {
  terminalManager.input(authenticatedUserId(peer), request.sessionId, request.data);
}

export function resizeTerminal(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "terminal.resize" }>,
) {
  terminalManager.resize(authenticatedUserId(peer), request.sessionId, request.cols, request.rows);
}

export function closeTerminal(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "terminal.close" }>,
) {
  terminalManager.close(authenticatedUserId(peer), request.sessionId);
  sendRealtimePeerMessage(peer, {
    type: "terminal.closed",
    requestId: request.requestId,
    sessionId: request.sessionId,
  });
}

export function subscribeTerminalEvents(peer: RealtimePeer) {
  const state = stateFor(peer);
  state.terminalUnsubscribe?.();
  state.terminalUnsubscribe = terminalEventBus.subscribe(authenticatedUserId(peer), (event) => {
    sendRealtimePeerMessage(peer, event);
  });
}

function resolveTerminalCwd(request: Extract<RealtimeClientMessage, { type: "terminal.open" }>) {
  const requestedCwd = trimmedOrNull(request.cwd);
  if (requestedCwd !== null) {
    return requestedCwd;
  }
  if (typeof request.threadId === "string" && request.threadId.length > 0) {
    const metadata = threadMetadataStore.get(request.hostId, request.threadId);
    const metadataCwd = trimmedOrNull(metadata?.cwd);
    if (metadataCwd !== null) {
      return metadataCwd;
    }
  }
  if (request.projectId !== null && request.projectId !== undefined) {
    const project = projectStore.get(request.projectId);
    if (project?.hostId === request.hostId && trimmedOrNull(project.remotePath) !== null) {
      return project.remotePath.trim();
    }
  }
  return null;
}

function terminalTitle(request: Extract<RealtimeClientMessage, { type: "terminal.open" }>) {
  if (request.scope === "thread") {
    const metadata =
      typeof request.threadId === "string" && request.threadId.length > 0
        ? threadMetadataStore.get(request.hostId, request.threadId)
        : null;
    return (
      firstNonEmptyString([metadata?.title, metadata?.name, request.threadId]) ?? "Thread terminal"
    );
  }
  if (
    request.scope === "project" &&
    request.projectId !== null &&
    request.projectId !== undefined
  ) {
    return firstNonEmptyString([projectStore.get(request.projectId)?.name]) ?? "Project terminal";
  }
  return "Host terminal";
}
