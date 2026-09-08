import type { SidebarAiSummary, SidebarSummarySource } from "~~/shared/types";
import { gatewayApi } from "@/utils/gateway-api";

export function requestSidebarAiSummaries(items: SidebarSummarySource[]) {
  return gatewayApi<{ data: SidebarAiSummary[]; available: boolean }>(
    "/api/threads/sidebar-summaries",
    {
      method: "POST",
      body: { items },
    },
  );
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
