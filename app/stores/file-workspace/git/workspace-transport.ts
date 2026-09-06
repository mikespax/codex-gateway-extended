import type { RemoteGitWorkspaceSnapshot } from "~~/shared/types";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { expectFileGitWorkspaceSnapshot } from "@/stores/gateway-realtime/response-parsers";
import type { GitWorkspaceScopeInput } from "./workspace-types";

export async function inspectRemoteGitWorkspace(
  input: GitWorkspaceScopeInput,
): Promise<RemoteGitWorkspaceSnapshot> {
  const response = await useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "file.git.workspace.inspect",
      requestId,
      ...input,
    }),
    expectFileGitWorkspaceSnapshot,
  );
  return response.snapshot;
}
