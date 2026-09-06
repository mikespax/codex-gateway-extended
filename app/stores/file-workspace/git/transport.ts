import type { RemoteGitFileComparison } from "~~/shared/types";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { expectFileGitComparison } from "@/stores/gateway-realtime/response-parsers";

export async function compareRemoteGitFile(input: {
  hostId: number;
  projectId: number;
  path: string;
}): Promise<RemoteGitFileComparison> {
  const response = await useGatewayRealtimeStore().request(
    (requestId) => ({ type: "file.git.compare", requestId, ...input }),
    expectFileGitComparison,
  );
  return response.comparison;
}
