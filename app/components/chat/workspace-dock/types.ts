import type { ComputedRef, Ref } from "vue";
import { z } from "zod";

export type WorkspacePanelKind =
  | "agent"
  | "files"
  | "gitReview"
  | "terminal"
  | "subagent"
  | "browser"
  | "tmux"
  | "hostMetrics";

export const workspaceDockPanelParamsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent") }),
  z.object({ kind: z.literal("files") }),
  z.object({ kind: z.literal("gitReview") }),
  z.object({ kind: z.literal("terminal"), sessionId: z.string().min(1) }),
  z.object({
    kind: z.literal("subagent"),
    subAgentHostId: z.number(),
    subAgentThreadId: z.string().min(1),
  }),
  z.object({ kind: z.literal("browser"), browserPanelId: z.string().min(1) }),
  z.object({ kind: z.literal("tmux") }),
  z.object({ kind: z.literal("hostMetrics"), hostId: z.number().int().positive() }),
]);

export type WorkspaceDockPanelParams = z.infer<typeof workspaceDockPanelParamsSchema>;

export function workspaceDockPanelParamsFromUnknown(value: unknown) {
  const result = workspaceDockPanelParamsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export type WorkspaceDockPanelParamsFor<K extends WorkspacePanelKind> = Extract<
  WorkspaceDockPanelParams,
  { kind: K }
>;

export interface WorkspaceDockProps {
  layout: "desktop" | "mobile";
}

export interface WorkspacePanelSelection {
  selectedHostId: Ref<number | null> | ComputedRef<number | null>;
  selectedProjectId: Ref<number | null> | ComputedRef<number | null>;
  selectedThreadId: Ref<string | null> | ComputedRef<string | null>;
}
