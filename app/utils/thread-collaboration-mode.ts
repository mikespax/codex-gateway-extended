import type {
  ReasoningEffort,
  ThreadCollaborationMode,
  ThreadSettingsState,
} from "~~/shared/types";
import { firstNonEmptyString } from "~~/shared/utils/strings";

export function buildThreadCollaborationMode(input: {
  mode: ThreadCollaborationMode["mode"];
  modelCandidates: Array<string | null | undefined>;
  effort: ReasoningEffort | null | undefined;
}): ThreadCollaborationMode | null {
  const model = firstNonEmptyString(input.modelCandidates);
  if (model === null) return null;
  return {
    mode: input.mode,
    settings: {
      model,
      reasoningEffort: input.effort ?? null,
      developerInstructions: null,
    },
  };
}

export function collaborationModeFromThreadSettings(
  settings: ThreadSettingsState | null | undefined,
) {
  return settings?.collaborationMode?.mode ?? "default";
}
