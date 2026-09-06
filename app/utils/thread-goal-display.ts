import type { ThreadGoal, ThreadGoalStatus } from "~~/shared/types";

export type ThreadGoalStatusControl = "pause" | "resume" | null;

export interface ThreadGoalStatusPresentation {
  triggerClass: string;
  labelClass: string;
  badgeClass: string;
}

// Keep the strip, title, and badge on one semantic palette. A status update then changes the
// whole affordance atomically instead of leaving a red badge inside an apparently active strip.
const THREAD_GOAL_STATUS_PRESENTATION = {
  active: {
    triggerClass: "border-primary/55 bg-primary/10 hover:border-primary/75 hover:bg-primary/15",
    labelClass: "text-primary",
    badgeClass: "border-primary/30 bg-primary/10 text-primary",
  },
  paused: {
    triggerClass:
      "border-ink-faint/55 bg-ink-faint/10 hover:border-ink-faint/75 hover:bg-ink-faint/15",
    labelClass: "text-ink-muted",
    badgeClass: "border-ink-faint/35 bg-ink-faint/10 text-ink-muted",
  },
  blocked: {
    triggerClass:
      "border-destructive/60 bg-destructive/10 hover:border-destructive/80 hover:bg-destructive/15",
    labelClass: "text-destructive",
    badgeClass: "border-destructive/35 bg-destructive/10 text-destructive",
  },
  usageLimited: {
    triggerClass:
      "border-accent-orange/60 bg-accent-orange/10 hover:border-accent-orange/80 hover:bg-accent-orange/15",
    labelClass: "text-accent-orange-deep",
    badgeClass: "border-accent-orange/35 bg-accent-orange/10 text-accent-orange-deep",
  },
  budgetLimited: {
    triggerClass:
      "border-accent-brown/60 bg-accent-brown/10 hover:border-accent-brown/80 hover:bg-accent-brown/15",
    labelClass: "text-accent-brown",
    badgeClass: "border-accent-brown/35 bg-accent-brown/10 text-accent-brown",
  },
  complete: {
    triggerClass:
      "border-accent-green/60 bg-accent-green/10 hover:border-accent-green/80 hover:bg-accent-green/15",
    labelClass: "text-accent-green",
    badgeClass: "border-accent-green/35 bg-accent-green/10 text-accent-green",
  },
} satisfies Record<ThreadGoalStatus, ThreadGoalStatusPresentation>;

export function isThreadGoalOngoing(goal: ThreadGoal | null): goal is ThreadGoal {
  return goal !== null && goal.status !== "complete";
}

export function threadGoalStatusControl(status: ThreadGoalStatus): ThreadGoalStatusControl {
  const controls: Record<ThreadGoalStatus, ThreadGoalStatusControl> = {
    active: "pause",
    paused: "resume",
    blocked: "resume",
    usageLimited: "resume",
    budgetLimited: null,
    complete: null,
  };
  return controls[status];
}

export function goalStatusI18nKey(status: ThreadGoalStatus) {
  const keys: Record<ThreadGoalStatus, string> = {
    active: "app.goalStatusActive",
    paused: "app.goalStatusPaused",
    blocked: "app.goalStatusBlocked",
    usageLimited: "app.goalStatusUsageLimited",
    budgetLimited: "app.goalStatusBudgetLimited",
    complete: "app.goalStatusComplete",
  };
  return keys[status];
}

export function threadGoalStatusPresentation(
  status: ThreadGoalStatus,
): ThreadGoalStatusPresentation {
  return THREAD_GOAL_STATUS_PRESENTATION[status];
}

export function formatGoalElapsed(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export function formatGoalTokens(value: number) {
  return value.toLocaleString();
}
