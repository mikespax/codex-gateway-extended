import type {
  AppServerThread,
  AppServerTurn,
  ThreadGoalStatus,
  ThreadHistoryItem,
  ThreadHistoryTurn,
} from "~~/shared/types";
import { statusValue, threadItemText } from "./thread-items";

const nonTerminalGoalStatuses = new Set<ThreadGoalStatus>([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
]);

export interface SidebarThreadOverview {
  goal: string | null;
  turnSummary: string | null;
  currentTask: string | null;
  lastUserInput: string | null;
}

/** Keep legacy compact labels readable without ever copying an entire command into a row. */
export function compactSidebarSummary(value: string | null | undefined, maxWords = 3) {
  const normalized = normalizeSidebarActivity(value);
  if (normalized === "") return null;
  return normalized.split(" ").slice(0, maxWords).join(" ");
}

/**
 * Keep the goal row to a few useful words while retaining the full objective in the tooltip.
 * This is intentionally local and deterministic: sidebar refreshes should not spend tokens or
 * send potentially sensitive work descriptions to an external summarizer.
 */
export function compactSidebarGoal(value: string | null | undefined, maxWords = 4) {
  const normalized = normalizeSidebarActivity(value);
  if (normalized === "") return null;
  const withoutLeadIn = normalized.replace(
    /^(?:please\s+|could\s+you\s+|can\s+you\s+|i(?:'d| would| need| want)\s+to\s+|let(?:'s| us)\s+|help\s+me\s+)/i,
    "",
  );
  const words = withoutLeadIn.split(" ").filter(Boolean);
  return words.slice(0, maxWords).join(" ") || normalized.split(" ").slice(0, maxWords).join(" ");
}

export function normalizeSidebarActivity(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

/** Keep sidebar prose useful at a glance without copying an entire turn into every row. */
export function summarizeSidebarText(value: string | null | undefined, maxCharacters = 120) {
  const normalized = normalizeSidebarActivity(value)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^[>*#-]+\s*/g, "")
    .trim();
  if (normalized === "") return null;
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized;
  if (firstSentence.length <= maxCharacters) return firstSentence;
  return `${firstSentence.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
}

export function sidebarSummaryForThread(input: {
  goalObjective?: string | null;
  goalStatus?: ThreadGoalStatus | null;
  currentOperation?: string | null;
}) {
  if (
    typeof input.goalObjective === "string" &&
    input.goalObjective !== "" &&
    input.goalStatus !== null &&
    input.goalStatus !== undefined &&
    nonTerminalGoalStatuses.has(input.goalStatus)
  ) {
    return normalizeSidebarActivity(input.goalObjective) || null;
  }
  return normalizeSidebarActivity(input.currentOperation) || null;
}

export function sidebarOverviewForThread(input: {
  goalObjective?: string | null;
  goalStatus?: ThreadGoalStatus | null;
  currentOperation?: string | null;
  turnSummary?: string | null;
  lastUserInput?: string | null;
}): SidebarThreadOverview | null {
  const overview = {
    goal:
      typeof input.goalObjective === "string" &&
      input.goalObjective !== "" &&
      input.goalStatus !== null &&
      input.goalStatus !== undefined &&
      nonTerminalGoalStatuses.has(input.goalStatus)
        ? normalizeSidebarActivity(input.goalObjective) || null
        : null,
    turnSummary: normalizeSidebarActivity(input.turnSummary) || null,
    currentTask: normalizeSidebarActivity(input.currentOperation) || null,
    lastUserInput: normalizeSidebarActivity(input.lastUserInput) || null,
  } satisfies SidebarThreadOverview;
  return Object.values(overview).some((value) => value !== null) ? overview : null;
}

export function threadGoalSummaryFromThread(thread: Pick<AppServerThread, "turns">) {
  for (const turn of [...thread.turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type !== "threadGoal") continue;
      const objective = typeof item.objective === "string" ? item.objective.trim() : "";
      const status = threadGoalStatus(item.status);
      // Thread/list may expose only `{ id, type }` summaries. Treat that as unknown so a
      // refresh cannot erase a goal learned from a live goal snapshot.
      if (objective === "" || status === null) return undefined;
      return { objective, status };
    }
  }
  return undefined;
}

/** Returns a stable, non-sensitive action label for the latest in-progress turn. */
export function currentOperationFromThread(thread: Pick<AppServerThread, "status" | "turns">) {
  const active = thread.status.type === "active";
  const latestTurn = thread.turns.at(-1);
  if (latestTurn === undefined) return undefined;
  if (!active && latestTurn.status !== "inProgress") return null;
  for (const item of [...latestTurn.items].reverse()) {
    const operation = operationForItem(item);
    if (operation !== null) return operation;
  }
  return "Working";
}

export function lastCompletedTurnSummaryFromThread(
  thread: Pick<AppServerThread, "turns">,
): string | undefined {
  for (const turn of [...thread.turns].reverse()) {
    if (statusValue(turn.status) !== "completed") continue;
    const summary = lastCompletedTurnSummaryFromTurn(turn);
    if (summary !== undefined) return summary;
  }
  return undefined;
}

export function lastCompletedTurnSummaryFromTurn(
  turn: Pick<AppServerTurn, "status" | "items"> | ThreadHistoryTurn,
) {
  if (statusValue(turn.status) !== "completed") return undefined;
  for (const item of [...(turn.items ?? [])].reverse()) {
    if (item.type !== "agentMessage" && item.type !== "plan") continue;
    const summary = summarizeSidebarText(threadItemText(item));
    if (summary !== null) return summary;
  }
  return undefined;
}

export function lastUserInputFromThread(
  thread: Pick<AppServerThread, "turns">,
): string | undefined {
  for (const turn of [...thread.turns].reverse()) {
    const input = lastUserInputFromTurn(turn);
    if (input !== undefined) return input;
  }
  return undefined;
}

export function lastUserInputFromTurn(turn: Pick<AppServerTurn, "items"> | ThreadHistoryTurn) {
  for (const item of [...(turn.items ?? [])].reverse()) {
    const input = lastUserInputFromItem(item);
    if (input !== undefined) return input;
  }
  return undefined;
}

/** Derive the current task from a freshly fetched sidebar history page. */
export function currentOperationFromTurns(turns: ThreadHistoryTurn[]) {
  const latestTurn = turns.at(-1);
  if (latestTurn === undefined || statusValue(latestTurn.status) !== "inProgress") return null;
  for (const item of [...(latestTurn.items ?? [])].reverse()) {
    const operation = operationForItem(item);
    if (operation !== null) return operation;
  }
  return "Working";
}

export function lastUserInputFromItem(item: ThreadHistoryItem) {
  if (item.type !== "userMessage") return undefined;
  return summarizeSidebarText(threadItemText(item)) ?? undefined;
}

export function operationForItem(item: ThreadHistoryItem) {
  if (item.pendingApproval !== null && item.pendingApproval !== undefined) {
    return "Waiting approval";
  }
  if (item.type === "commandExecution") return "Running a command";
  if (item.type === "fileChange") return "Updating files";
  if (item.type === "webSearch") return "Searching the web";
  if (item.type === "agentMessage") return "Writing a response";
  if (item.type === "reasoning") return "Thinking through the change";
  if (item.type === "plan" || item.type === "turnPlan") return "Planning the next steps";
  if (item.type === "imageGeneration") return "Generating an image";
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") return "Using a tool";
  if (item.type === "subAgentActivity" || item.type === "collabAgentToolCall") {
    return "Running sub-agents";
  }
  if (item.type === "sleep") return "Sleeping";
  if (item.type === "permissionsRequest" || item.type === "serverRequest") {
    return "Waiting for input";
  }
  if (item.type === "requestUserInput") return "Waiting for input";
  if (item.type === "hookPrompt") return "Running a hook";
  if (item.type === "contextCompaction") return "Compacting context";
  return null;
}

function threadGoalStatus(value: unknown): ThreadGoalStatus | null {
  const status = statusValue(value);
  return status === "active" ||
    status === "paused" ||
    status === "blocked" ||
    status === "usageLimited" ||
    status === "budgetLimited" ||
    status === "complete"
    ? status
    : null;
}
