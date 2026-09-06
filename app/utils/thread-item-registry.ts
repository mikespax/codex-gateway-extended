import type { Component } from "vue";
import type { ThreadTimelineItemType } from "~~/shared/types";
import UserMessageItem from "@/components/thread/items/UserMessageItem.vue";
import AgentMessageItem from "@/components/thread/items/AgentMessageItem.vue";
import PlanItem from "@/components/thread/items/planning/PlanItem.vue";
import TurnPlanItem from "@/components/thread/items/planning/TurnPlanItem.vue";
import ReasoningItem from "@/components/thread/items/ReasoningItem.vue";
import CommandExecutionItem from "@/components/thread/items/CommandExecutionItem.vue";
import FileChangeItem from "@/components/thread/items/file-change/FileChangeItem.vue";
import ToolCallItem from "@/components/thread/items/ToolCallItem.vue";
import ImageViewItem from "@/components/thread/items/ImageViewItem.vue";
import SleepItem from "@/components/thread/items/SleepItem.vue";
import ContextCompactionItem from "@/components/thread/items/ContextCompactionItem.vue";
import ServerRequestItem from "@/components/thread/items/requests/ServerRequestItem.vue";
import RequestUserInputItem from "@/components/thread/items/requests/RequestUserInputItem.vue";
import McpElicitationRequestItem from "@/components/thread/items/requests/McpElicitationRequestItem.vue";
import PermissionsRequestItem from "@/components/thread/items/requests/PermissionsRequestItem.vue";
import DynamicToolClientRequestItem from "@/components/thread/items/requests/DynamicToolClientRequestItem.vue";
import ChatgptAuthTokensRefreshRequestItem from "@/components/thread/items/requests/ChatgptAuthTokensRefreshRequestItem.vue";
import ProtocolMismatchRequestItem from "@/components/thread/items/requests/ProtocolMismatchRequestItem.vue";
import HookPromptItem from "@/components/thread/items/HookPromptItem.vue";
import SubAgentActivityItem from "@/components/thread/items/subagent/SubAgentActivityItem.vue";
import CollabAgentToolCallItem from "@/components/thread/items/subagent/CollabAgentToolCallItem.vue";
import AppNotificationItem from "@/components/thread/items/AppNotificationItem.vue";
import ThreadGoalItem from "@/components/thread/items/planning/ThreadGoalItem.vue";

const threadItemComponents = {
  agentMessage: AgentMessageItem,
  appNotification: AppNotificationItem,
  attestationRequest: ProtocolMismatchRequestItem,
  chatgptAuthTokensRefreshRequest: ChatgptAuthTokensRefreshRequestItem,
  commandExecution: CommandExecutionItem,
  contextCompaction: ContextCompactionItem,
  collabAgentToolCall: CollabAgentToolCallItem,
  dynamicToolClientRequest: DynamicToolClientRequestItem,
  dynamicToolCall: ToolCallItem,
  enteredReviewMode: ToolCallItem,
  exitedReviewMode: ToolCallItem,
  fileChange: FileChangeItem,
  hookPrompt: HookPromptItem,
  imageGeneration: ToolCallItem,
  imageView: ImageViewItem,
  mcpElicitationRequest: McpElicitationRequestItem,
  mcpToolCall: ToolCallItem,
  permissionsRequest: PermissionsRequestItem,
  plan: PlanItem,
  reasoning: ReasoningItem,
  requestUserInput: RequestUserInputItem,
  serverRequest: ServerRequestItem,
  sleep: SleepItem,
  subAgentActivity: SubAgentActivityItem,
  threadGoal: ThreadGoalItem,
  turnPlan: TurnPlanItem,
  userMessage: UserMessageItem,
  webSearch: ToolCallItem,
} satisfies Record<ThreadTimelineItemType, Component>;

export type ThreadItemType = keyof typeof threadItemComponents;

export function componentForThreadItem(type: ThreadTimelineItemType): Component {
  return threadItemComponents[type];
}
