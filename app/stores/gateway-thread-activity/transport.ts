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
