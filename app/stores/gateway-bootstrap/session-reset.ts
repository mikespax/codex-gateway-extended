import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { useGatewayBrowserStore } from "@/stores/gateway-browser";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayTerminalStore } from "@/stores/gateway-terminal";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";
import { useGatewayWorkspaceLayoutStore } from "@/stores/gateway-workspace-layout";
import { useFileGitReviewPanelStore } from "@/stores/file-workspace/git/review-panel";
import { useGatewayBootstrapStore } from ".";

/**
 * Clears every page-session projection owned by the authenticated gateway session.
 *
 * Keep this list centralized. Root components must not each reset a convenient subset: Host and
 * Thread ids are only unique within one user's catalog, so retaining any runtime projection can
 * make the next account briefly render or request the previous account's resources.
 */
export function resetGatewayClientSession() {
  // Closing transport first prevents new events from refilling stores while they are cleared.
  useGatewayRealtimeStore().resetForSessionChange();
  useGatewayBootstrapStore().resetState();
  useGatewayCatalogStore().resetState();
  useGatewayConfigStore().resetState();
  useGatewayNavigationStore().resetState();
  useGatewayThreadViewStore().resetState();
  useGatewayThreadTurnsStore().resetState();
  useGatewayThreadRuntimeStore().resetState();
  useGatewayThreadActivityStore().resetState();
  useGatewayComposerStore().resetState();
  useGatewayTerminalStore().resetState();
  useGatewayBrowserStore().resetRuntime();
  useGatewayTmuxStore().resetState();
  useGatewayFileWorkspaceStore().resetRuntime();
  useFileGitReviewPanelStore().reset();
  useGatewayWorkspaceLayoutStore().resetRuntimeState();
}
