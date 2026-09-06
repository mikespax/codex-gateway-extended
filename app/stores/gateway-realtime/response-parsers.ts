import type { RealtimeServerMessage } from "~~/shared/types";
import { threadHistoryTurnFromUnknown } from "~~/shared/runtime/app-server";

type RealtimeResponseMessage = Extract<RealtimeServerMessage, { requestId: string }>;

function unexpectedResponse(expected: RealtimeResponseMessage["type"], actual: string): never {
  throw new Error(`Expected realtime response ${expected}, received ${actual}`);
}

export function expectBrowserOpened(message: RealtimeResponseMessage) {
  if (message.type !== "browser.opened") unexpectedResponse("browser.opened", message.type);
  return message;
}

export function expectFileGitComparison(message: RealtimeResponseMessage) {
  if (message.type !== "file.git.comparison") {
    unexpectedResponse("file.git.comparison", message.type);
  }
  return message;
}

export function expectFileGitWorkspaceSnapshot(message: RealtimeResponseMessage) {
  if (message.type !== "file.git.workspace.snapshot") {
    unexpectedResponse("file.git.workspace.snapshot", message.type);
  }
  return message;
}

export function expectThreadGoalUpdated(message: RealtimeResponseMessage) {
  if (message.type !== "thread.goal.updated") {
    unexpectedResponse("thread.goal.updated", message.type);
  }
  return message;
}

export function expectThreadGoalSnapshot(message: RealtimeResponseMessage) {
  if (message.type !== "thread.goal.snapshot") {
    unexpectedResponse("thread.goal.snapshot", message.type);
  }
  return message;
}

export function expectTerminalOpened(message: RealtimeResponseMessage) {
  if (message.type !== "terminal.opened") unexpectedResponse("terminal.opened", message.type);
  return message;
}

export function expectThreadSnapshot(message: RealtimeResponseMessage) {
  if (message.type !== "thread.snapshot") unexpectedResponse("thread.snapshot", message.type);
  return message;
}

export function expectThreadStarted(message: RealtimeResponseMessage) {
  if (message.type !== "thread.started") unexpectedResponse("thread.started", message.type);
  return message;
}

export function expectTurnStartAccepted(message: RealtimeResponseMessage) {
  if (message.type !== "turn.start.accepted") {
    unexpectedResponse("turn.start.accepted", message.type);
  }
  if (message.turn === undefined) return { ...message, turn: undefined };
  const turn = threadHistoryTurnFromUnknown(message.turn);
  if (turn === null) throw new Error("Realtime turn.start.accepted contained an invalid turn");
  return { ...message, turn };
}

export function expectTurnSteerAccepted(message: RealtimeResponseMessage) {
  if (message.type !== "turn.steer.accepted") {
    unexpectedResponse("turn.steer.accepted", message.type);
  }
  return message;
}

export function expectTurnInterruptAccepted(message: RealtimeResponseMessage) {
  if (message.type !== "turn.interrupt.accepted") {
    unexpectedResponse("turn.interrupt.accepted", message.type);
  }
  return message;
}

export function expectThreadTurnsPage(message: RealtimeResponseMessage) {
  if (message.type !== "thread.turns.page") unexpectedResponse("thread.turns.page", message.type);
  return message;
}
