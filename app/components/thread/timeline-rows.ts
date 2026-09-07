import type { ThreadTimelineItem, ThreadTimelineTurn } from "~~/shared/types";
import type { DisplayedTurnTiming } from "@/utils/turn-timing";
import { threadItemText } from "@/utils/thread-items";
import { itemKey, userMessageVariant, type ThreadTurnSections } from "./thread-turn-sections";
import { commandDisplayLabel } from "@/utils/thread-item-display";
import { compactCompletedFileChangeRuns } from "./completed-file-change-runs";

export type { ThreadTimelineTurn } from "~~/shared/types";

type ThreadTimelineItemSection = "user" | "intermediate" | "final";

const estimatedItemHeights: Partial<Record<ThreadTimelineItem["type"], number>> = {
  commandExecution: 48,
  fileChange: 48,
  agentMessage: 144,
  reasoning: 128,
  userMessage: 160,
};

export type ThreadTimelineRow =
  | {
      key: string;
      type: "intermediateHeader";
      turnId: string;
      count: number;
      open: boolean;
      preview: string;
      segmentNumber?: number;
      segmentCount?: number;
      working?: boolean;
      startedAt?: number | null;
      latestOperation?: string | null;
      footer?: boolean;
    }
  | {
      key: string;
      type: "item";
      turnId: string;
      section: ThreadTimelineItemSection;
      item: ThreadTimelineItem;
      userMessageVariant: "normal" | "steer";
      turnTiming: DisplayedTurnTiming | null;
      agentActionsAvailable: boolean;
      sentAt: number | string | null;
      turnIsActive: boolean;
    }
  | {
      key: string;
      type: "turnDuration";
      turnId: string;
      startedAt: number | null;
      completedAt: number | null;
      durationMs: number | null;
      active: boolean;
    }
  | {
      key: string;
      type: "workingStatus";
      turnId: string;
      startedAt: number | null;
      latestOperation: string | null;
    };

export interface ThreadTimelineTurnState {
  turn: ThreadTimelineTurn;
  sections: ThreadTurnSections;
  intermediateOpen: boolean;
}

// Every visible entry is a direct row of the Agent timeline. Do not wrap intermediate items in a
// second virtualizer: two height caches sharing one scroll element can leave stale blank space on
// WebKit. Collapsing is represented only by omitting intermediate item rows from this flat model.
export function buildThreadTimelineRows(input: {
  threadId: string | null;
  turns: ThreadTimelineTurnState[];
  agentActionsAvailable: boolean;
}) {
  return input.turns.flatMap(({ turn, sections, intermediateOpen }) => {
    const rows: ThreadTimelineRow[] = [];
    const timing = displayedTurnTiming(turn, sections.turnIsActive);
    const timingTarget = sections.finalItems.findLast((item) => item.type === "agentMessage");
    appendItemRows(rows, input.threadId, turn, "user", sections.userItems, sections);

    const intermediateSegments = splitIntermediateSegments(sections);
    intermediateSegments.forEach((segment, segmentIndex) => {
      const isLatestSegment = segmentIndex === intermediateSegments.length - 1;
      if (segment.promptItem) {
        appendItemRows(rows, input.threadId, turn, "user", [segment.promptItem], sections);
      }
      const intermediatePresentation = presentIntermediateItems(
        segment.items,
        sections.turnIsActive,
        isLatestSegment,
      );
      const working = sections.turnIsActive && isLatestSegment;
      const latestOperation = working ? latestIntermediateOperation(segment.items) : null;
      rows.push({
        key: `${input.threadId}:turn-${turn.id}:intermediate-header-${segmentIndex}`,
        type: "intermediateHeader",
        turnId: turn.id,
        count: intermediatePresentation.count,
        open: intermediateOpen,
        preview: intermediatePreview(intermediatePresentation.items),
        segmentNumber: segmentIndex + 1,
        segmentCount: intermediateSegments.length,
        working,
        startedAt: working ? timing.startedAt : undefined,
        latestOperation,
      });
      if (intermediateOpen) {
        appendItemRows(
          rows,
          input.threadId,
          turn,
          "intermediate",
          intermediatePresentation.items,
          sections,
        );
        if (intermediatePresentation.showWorkingStatus) {
          rows.push({
            key: `${input.threadId}:turn-${turn.id}:working-status`,
            type: "workingStatus",
            turnId: turn.id,
            startedAt: timing.startedAt,
            latestOperation: latestIntermediateOperation(segment.items),
          });
        }
        if (isLatestSegment) {
          rows.push({
            key: `${input.threadId}:turn-${turn.id}:intermediate-footer`,
            type: "intermediateHeader",
            turnId: turn.id,
            count: intermediatePresentation.count,
            open: true,
            preview: "",
            footer: true,
          });
        }
      }
    });

    appendItemRows(
      rows,
      input.threadId,
      turn,
      "final",
      sections.finalItems,
      sections,
      timingTarget,
      timing,
      input.agentActionsAvailable,
    );
    // Completed turns normally render timing beside the final answer's copy action. Keep a
    // standalone row only for interrupted/error turns that never produced an Agent answer.
    if (input.agentActionsAvailable && hasTimingValue(timing) && timingTarget === undefined) {
      rows.push({
        key: `${input.threadId}:turn-${turn.id}:duration`,
        type: "turnDuration",
        turnId: turn.id,
        ...timing,
      });
    }
    return rows;
  });
}

export function reuseUnchangedTimelineRows(
  previous: ThreadTimelineRow[] | undefined,
  next: ThreadTimelineRow[],
) {
  if (previous === undefined || previous.length === 0) return next;
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  return next.map((row) => {
    const candidate = previousByKey.get(row.key);
    return candidate !== undefined && sameTimelineRow(candidate, row) ? candidate : row;
  });
}

export function estimateThreadTimelineRow(row: ThreadTimelineRow | undefined) {
  if (row === undefined) return 96;
  if (row.type === "intermediateHeader") return 72;
  if (row.type === "turnDuration") return 28;
  if (row.type === "workingStatus") {
    return row.latestOperation !== null && row.latestOperation !== "" ? 52 : 36;
  }
  return estimatedItemHeights[row.item.type] ?? 96;
}

function presentIntermediateItems(
  intermediateItems: ThreadTimelineItem[],
  turnIsActive: boolean,
  isLatestSegment: boolean,
) {
  const items = compactCompletedFileChangeRuns(
    intermediateItems.filter((item) => !isRoutineLiveActivity(item)),
  );
  if (!turnIsActive) {
    return {
      items,
      count: items.length,
      showWorkingStatus: false,
    };
  }

  const showWorkingStatus = isLatestSegment;
  return {
    items,
    count: items.length + (showWorkingStatus ? 1 : 0),
    showWorkingStatus,
  };
}

function latestIntermediateOperation(items: ThreadTimelineItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const operation = safeIntermediateOperation(items[index]!);
    if (operation !== null) return operation;
  }
  return null;
}

function safeIntermediateOperation(item: ThreadTimelineItem) {
  if (item.type === "commandExecution") {
    return compactOperationText(commandDisplayLabel(item.command)) || "Command";
  }
  if (item.type === "fileChange") {
    return "Updating files";
  }
  if (item.type === "webSearch") {
    return compactOperationText(item.query) || "Web search";
  }
  return null;
}

function compactOperationText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function isRoutineLiveActivity(item: ThreadTimelineItem) {
  if (item.type === "commandExecution") {
    return item.pendingApproval == null;
  }
  if (item.type === "reasoning") {
    return threadItemText(item).trim() === "";
  }
  return [
    "appNotification",
    "collabAgentToolCall",
    "contextCompaction",
    "dynamicToolCall",
    "enteredReviewMode",
    "exitedReviewMode",
    "imageView",
    "mcpToolCall",
    "sleep",
    "subAgentActivity",
    "webSearch",
  ].includes(item.type);
}

function splitIntermediateSegments(sections: ThreadTurnSections) {
  const segments: Array<{ promptItem?: ThreadTimelineItem; items: ThreadTimelineItem[] }> = [];
  let current = {
    promptItem: undefined as ThreadTimelineItem | undefined,
    items: [] as ThreadTimelineItem[],
  };

  sections.intermediateItems.forEach((item) => {
    if (userMessageVariant(item, sections) === "steer") {
      if (current.items.length || current.promptItem) segments.push(current);
      current = { promptItem: item, items: [] };
      return;
    }
    current.items.push(item);
  });
  if (
    current.items.length ||
    current.promptItem ||
    (sections.turnIsActive && segments.length === 0)
  ) {
    segments.push(current);
  }
  return segments;
}

function intermediatePreview(items: ThreadTimelineItem[]) {
  return items
    .slice(-2)
    .map(intermediateItemPreview)
    .filter((value, index, values) => value !== "" && values.indexOf(value) === index)
    .join(" · ")
    .slice(0, 240);
}

function intermediateItemPreview(item: ThreadTimelineItem) {
  if (item.type === "commandExecution") {
    return commandDisplayLabel(item.command).replace(/\s+/g, " ");
  }
  if (item.type === "reasoning") {
    return threadItemText(item).replace(/\s+/g, " ").trim() || "Thinking…";
  }
  if (item.type === "webSearch") {
    return typeof item.query === "string" && item.query.trim() !== ""
      ? item.query.replace(/\s+/g, " ").trim()
      : "Web search";
  }
  const text = "text" in item && typeof item.text === "string" ? item.text : "";
  return text.replace(/\s+/g, " ").trim() || item.type;
}

function appendItemRows(
  rows: ThreadTimelineRow[],
  threadId: string | null,
  turn: ThreadTimelineTurn,
  section: ThreadTimelineItemSection,
  items: ThreadTimelineItem[],
  sections: ThreadTurnSections,
  timingTarget?: ThreadTimelineItem,
  timing: DisplayedTurnTiming | null = null,
  agentActionsAvailable = false,
) {
  items.forEach((item, index) => {
    rows.push({
      key: `${threadId}:turn-${turn.id}:${section}:${itemKey(item, section, index)}`,
      type: "item",
      turnId: turn.id,
      section,
      item,
      userMessageVariant: userMessageVariant(item, sections),
      turnTiming: item === timingTarget ? timing : null,
      agentActionsAvailable: item === timingTarget && agentActionsAvailable,
      sentAt: messageTimestamp(item, turn),
      turnIsActive: sections.turnIsActive,
    });
  });
}

function messageTimestamp(item: ThreadTimelineItem, turn: ThreadTimelineTurn) {
  if (item.type === "userMessage") {
    return firstTimestamp(item.createdAt, item.startedAt, turn.startedAt);
  }
  if (item.type === "agentMessage") {
    return firstTimestamp(
      item.completedAt,
      item.createdAt,
      turn.completedAt,
      item.startedAt,
      turn.startedAt,
    );
  }
  return null;
}

function firstTimestamp(...values: unknown[]): number | string | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value))) {
      return value;
    }
  }
  return null;
}

function displayedTurnTiming(turn: ThreadTimelineTurn, active: boolean): DisplayedTurnTiming {
  const hasTerminalTiming = turn.completedAt != null || turn.durationMs != null;
  return {
    startedAt:
      (active || hasTerminalTiming) && typeof turn.startedAt === "number" ? turn.startedAt : null,
    completedAt: typeof turn.completedAt === "number" ? turn.completedAt : null,
    durationMs: turn.durationMs ?? null,
    active,
  };
}

function hasTimingValue(timing: DisplayedTurnTiming) {
  return timing.startedAt !== null || timing.durationMs !== null;
}

function sameTimelineRow(left: ThreadTimelineRow, right: ThreadTimelineRow) {
  if (left.type !== right.type) return false;
  if (left.type === "intermediateHeader" && right.type === "intermediateHeader") {
    return (
      left.count === right.count &&
      left.open === right.open &&
      left.preview === right.preview &&
      left.segmentNumber === right.segmentNumber &&
      left.segmentCount === right.segmentCount &&
      left.working === right.working &&
      left.startedAt === right.startedAt &&
      left.latestOperation === right.latestOperation &&
      left.footer === right.footer &&
      left.turnId === right.turnId
    );
  }
  if (left.type === "item" && right.type === "item") {
    // App-server deltas mutate this reactive item proxy in place. Reuse the lightweight row wrapper
    // so unrelated mounted Markdown rows do not rerender, but never clone or mark the item raw:
    // nested text/output reactivity is the official Vue update path that feeds TanStack's row
    // ResizeObserver. A separate presentation revision would duplicate timeline state.
    return (
      left.item === right.item &&
      left.turnId === right.turnId &&
      left.section === right.section &&
      left.userMessageVariant === right.userMessageVariant &&
      left.agentActionsAvailable === right.agentActionsAvailable &&
      left.sentAt === right.sentAt &&
      left.turnIsActive === right.turnIsActive &&
      sameTurnTiming(left.turnTiming, right.turnTiming)
    );
  }
  if (left.type === "turnDuration" && right.type === "turnDuration") {
    return (
      left.turnId === right.turnId &&
      left.startedAt === right.startedAt &&
      left.completedAt === right.completedAt &&
      left.durationMs === right.durationMs &&
      left.active === right.active
    );
  }
  if (left.type === "workingStatus" && right.type === "workingStatus") {
    return (
      left.turnId === right.turnId &&
      left.startedAt === right.startedAt &&
      left.latestOperation === right.latestOperation
    );
  }
  return false;
}

function sameTurnTiming(left: DisplayedTurnTiming | null, right: DisplayedTurnTiming | null) {
  if (left === null || right === null) return left === right;
  return (
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.durationMs === right.durationMs &&
    left.active === right.active
  );
}
