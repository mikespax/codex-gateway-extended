import {
  SIDEBAR_SUMMARY_BATCH_LIMIT,
  SIDEBAR_SUMMARY_FIELD_MAX_LENGTH,
  type SidebarAiSummary,
  type SidebarSummarySource,
} from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";

export function requestSidebarAiSummaries(items: SidebarSummarySource[]) {
  return gatewayApi<{ data: SidebarAiSummary[]; available: boolean }>(
    "/api/threads/sidebar-summaries",
    {
      method: "POST",
      body: {
        items: items.slice(0, SIDEBAR_SUMMARY_BATCH_LIMIT).map((item) => ({
          ...item,
          goal: trimSidebarSummaryValue(item.goal),
          turnSummary: trimSidebarSummaryValue(item.turnSummary),
          currentTask: trimSidebarSummaryValue(item.currentTask),
          lastUserInput: trimSidebarSummaryValue(item.lastUserInput),
        })),
      },
    },
  );
}

function trimSidebarSummaryValue(value: string | null) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized === "" ? null : normalized.slice(0, SIDEBAR_SUMMARY_FIELD_MAX_LENGTH);
}

export function requestSidebarThreadStorage(input: {
  hostId: number;
  threads: Array<{ threadId: string; path: string | null }>;
}) {
  return gatewayApi<{
    data: Array<{ threadId: string; threadBytes: number | null }>;
  }>("/api/threads/storage", {
    method: "POST",
    body: input,
  });
}
