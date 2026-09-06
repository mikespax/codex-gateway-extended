import type { ThreadGoal, ThreadGoalStatus } from "~~/shared/types";
import type { SlashMenuItem } from "@/composables/composer/useSlashCommands";
import { threadGoalStatusControl } from "@/utils/thread-goal-display";

export type GoalSlashActionId = Extract<
  SlashMenuItem["id"],
  "goal-objective" | "goal-edit" | "goal-pause" | "goal-resume" | "goal-clear"
>;

export interface GoalSlashAction extends SlashMenuItem {
  id: GoalSlashActionId;
}

export function goalSlashActions(input: {
  goal: ThreadGoal | null;
  commandPrefix: string;
  labels: Record<GoalSlashActionId, { title: string; description: string }>;
}): GoalSlashAction[] {
  if (!input.goal) {
    return [goalAction("goal-objective", `${input.commandPrefix} <objective>`, input.labels)];
  }
  const actionIds = goalActionIdsForStatus(input.goal.status);
  return actionIds.map((id) => goalAction(id, goalCommand(input.commandPrefix, id), input.labels));
}

function goalActionIdsForStatus(status: ThreadGoalStatus): GoalSlashActionId[] {
  const control = threadGoalStatusControl(status);
  const controlAction: GoalSlashActionId[] =
    control === null ? [] : [control === "pause" ? "goal-pause" : "goal-resume"];
  return ["goal-edit", ...controlAction, "goal-clear"];
}

function goalAction(
  id: GoalSlashActionId,
  command: string,
  labels: Record<GoalSlashActionId, { title: string; description: string }>,
): GoalSlashAction {
  return {
    id,
    command,
    title: labels[id].title,
    description: labels[id].description,
  };
}

function goalCommand(prefix: string, id: GoalSlashActionId) {
  const args: Record<Exclude<GoalSlashActionId, "goal-objective">, string> = {
    "goal-edit": "edit",
    "goal-pause": "pause",
    "goal-resume": "resume",
    "goal-clear": "clear",
  };
  if (id === "goal-objective") {
    return prefix;
  }
  return `${prefix} ${args[id]}`;
}
