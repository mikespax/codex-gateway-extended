/** The small, redacted sidebar context sent to the optional Codex summarizer. */
export interface SidebarSummarySource {
  hostId: number;
  threadId: string;
  goal: string | null;
  turnSummary: string | null;
  currentTask: string | null;
  lastUserInput: string | null;
}

/** AI-generated display labels. These never replace the underlying local fields. */
export interface SidebarAiSummary {
  hostId: number;
  threadId: string;
  goal: string | null;
  turnSummary: string | null;
  currentTask: string | null;
  lastUserInput: string | null;
  sourceFingerprint: string;
  generatedAt: number;
  model: string;
}

export function sidebarSummarySourceFingerprint(input: SidebarSummarySource) {
  const source = JSON.stringify([
    input.hostId,
    input.threadId,
    input.goal ?? "",
    input.turnSummary ?? "",
    input.currentTask ?? "",
    input.lastUserInput ?? "",
  ]);
  // Keep stale-response guards opaque. Returning the source JSON here would echo user text in
  // the API response and browser state, including a value that may contain sensitive content.
  let first = 2_166_136_261;
  let second = 2_654_435_761;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619) >>> 0;
    second = Math.imul(second ^ code, 1_099_511_627) >>> 0;
  }
  return `v1-${first.toString(16)}-${second.toString(16)}`;
}
