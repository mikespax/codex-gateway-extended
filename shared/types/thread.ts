import type { GatewayEvent, ProjectRecord } from "./records";
import type { ThreadHistoryItem, ThreadTimelineHistoryState } from "../thread-history/types";

export type ThreadRuntimeStatus = "idle" | "running" | "completed" | "failed" | "interrupted";

export interface ThreadRuntimeStatusUpdate {
  hostId: number;
  threadId: string;
  status: ThreadRuntimeStatus;
  turnId?: string | null;
}
export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadGoalTimelineItem extends Record<string, unknown> {
  type: "threadGoal";
  id: string;
  turnId?: string | null;
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadOpenResult {
  hostId: number;
  thread: GatewayThread;
  history: ThreadTimelineHistoryState;
  lastEventId: number;
  eventEpoch: string;
  runtimeStatus?: ThreadRuntimeStatus | null;
  threadSettings?: ThreadSettingsState | null;
  tokenUsage?: ThreadTokenUsageState | null;
  projectId?: number | null;
  project?: ProjectRecord | null;
  turnsPage: {
    nextCursor: string | null;
    backwardsCursor: string | null;
  };
  recentEvents: GatewayEvent[];
}

export interface ThreadMoveResult {
  source: {
    hostId: number;
    threadId: string;
  };
  target: {
    hostId: number;
    projectId: number;
    threadId: string;
    title: string;
    cwd: string;
  };
}

export interface ThreadNativeMigrationResult {
  mode: "native";
  source: {
    hostId: number;
    threadId: string;
    rolloutPath: string;
    historyMode: "legacy" | "paginated";
    turnCount: number;
    queueCount: number;
  };
  target: {
    hostId: number;
    threadId: string;
    rolloutPath: string;
    cwd: string;
    requestedCwd: string;
    historyMode: "legacy" | "paginated";
    turnCount: number;
    queueCount: number;
  };
  transfer: {
    files: number;
    bytes: number;
    rollouts: {
      files: number;
      bytes: number;
    };
    attachments: {
      files: number;
      bytes: number;
    };
  };
  verification: {
    sameThreadId: true;
    sameRolloutRelativePath: true;
    metadataParity: true;
    historyParity: true;
    descendantsVerified: true;
    goalsVerified: true;
    goalAccountingPreserved: boolean;
    queuesVerified: true;
  };
  /** Non-fatal compatibility notes that do not expose paths or session contents. */
  warnings: string[];
  descendants: Array<{
    threadId: string;
    parentThreadId: string | null;
    rolloutPath: string;
    targetRolloutPath: string;
    turnCount: number;
    queueCount: number;
  }>;
}

export type ThreadMoveReadinessStatus =
  | "ready"
  | "source_workspace_missing"
  | "target_workspace_missing"
  | "source_not_git"
  | "target_not_git"
  | "repository_mismatch"
  | "source_commit_missing_on_target";

export interface ThreadMoveReadiness {
  status: ThreadMoveReadinessStatus;
  source: {
    hostId: number;
    threadId: string;
    cwd: string;
  };
  target: {
    hostId: number;
    cwd: string;
  };
  /** Present when the source was resolved through a dedicated VPS operations fallback. */
  sourceWorkspaceKind?: "operations_fallback";
  sourceWorkspaceCwd?: string;
  recommendedTargetCwd?: string | null;
}

export interface ThreadTurnsPageResult {
  history: ThreadTimelineHistoryState;
  turnsPage: {
    nextCursor: string | null;
    backwardsCursor: string | null;
  };
}

export type ApprovalPolicy = "untrusted" | "on-request" | "never";
export type ReasoningEffort = string;

export interface ThreadCollaborationMode {
  mode: "default" | "plan";
  settings: {
    model: string;
    reasoningEffort?: ReasoningEffort | null;
    developerInstructions?: string | null;
  };
}

export interface ThreadSettingsState {
  model?: string | null;
  effort?: ReasoningEffort | null;
  serviceTier?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  collaborationMode?: ThreadCollaborationMode | null;
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export type AppServerThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: Array<"waitingOnApproval" | "waitingOnUserInput"> };

export type AppServerSessionSource =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | "unknown"
  | { custom: string }
  | { subAgent: AppServerSubAgentSource };

export type AppServerSubAgentSource =
  | "review"
  | "compact"
  | "memory_consolidation"
  | { other: string }
  | {
      thread_spawn: {
        parent_thread_id: string;
        depth: number;
        agent_path: string | null;
        agent_nickname: string | null;
        agent_role: string | null;
      };
    };

export interface AppServerTurn {
  id: string;
  items: ThreadHistoryItem[];
  itemsView: "notLoaded" | "summary" | "full";
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: {
    message: string;
    codexErrorInfo: CodexErrorInfo | null;
    additionalDetails: string | null;
  } | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export type CodexErrorInfo =
  | "contextWindowExceeded"
  | "sessionBudgetExceeded"
  | "usageLimitExceeded"
  | "serverOverloaded"
  | "cyberPolicy"
  | "misalignmentPolicyViolation"
  | "internalServerError"
  | "unauthorized"
  | "badRequest"
  | "threadRollbackFailed"
  | "sandboxError"
  | "other"
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: "review" | "compact" } };

export interface AppServerThreadSection {
  id: string;
  name: string;
  appearance: {
    icon: string | null;
    color: string | null;
  } | null;
}

/** Exact Codex 0.149 Thread DTO for the experimental API negotiated by Gateway. */
export interface AppServerThread {
  id: string;
  extra: Record<never, never> | null;
  sessionId: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  preview: string;
  ephemeral: boolean;
  section: AppServerThreadSection | null;
  sectionEnteredAt: number | null;
  projectId: string | null;
  historyMode: "legacy" | "paginated";
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: AppServerThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: AppServerSessionSource;
  canAcceptDirectInput: boolean | null;
  threadSource: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: {
    sha: string | null;
    branch: string | null;
    originUrl: string | null;
  } | null;
  name: string | null;
  turns: AppServerTurn[];
}

/** Browser/server projection with user-scoped Gateway navigation metadata. */
export type GatewayThread = Omit<AppServerThread, "projectId"> & {
  /** App-server's global experimental project identity; never use it as a Gateway SQLite id. */
  appServerProjectId: string | null;
  hostId: number;
  projectId: number | null;
  pinned: boolean;
  title: string | null;
  /** Best-effort bytes for this thread's persisted Codex state on its host. */
  threadBytes?: number | null;
};

export interface ThreadTokenUsageState {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface FileReference {
  type: "file";
  /** Normalized path relative to the selected project root. */
  path: string;
  name: string;
}

export interface ComposerTurnOptions {
  model?: string | null;
  effort?: ReasoningEffort | null;
  serviceTier?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  collaborationMode?: ThreadCollaborationMode | null;
  images?: Array<{
    path?: string;
    url?: string;
    detail?: "low" | "high" | "auto" | "original";
  }>;
  files?: Array<{
    path: string;
    name: string;
    mimeType?: string | null;
    size: number;
    isImage: boolean;
  }>;
  references?: FileReference[];
}
