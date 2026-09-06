import { useAuthStore } from "@/stores/auth";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { messageFromError } from "@/stores/gateway/thread-utils/identity";
import {
  hasGatewayRouteSelection,
  readGatewayRouteSelection,
  writeGatewayRouteSelection,
} from "@/stores/gateway/route-state";
import { useGatewayBootstrapStore } from ".";

/** Orchestrates independent stores without making the bootstrap state store import them. */
export async function refreshGatewayClient() {
  const auth = useAuthStore();
  const sessionEpoch = auth.sessionEpoch;
  const bootstrap = useGatewayBootstrapStore();
  const catalog = useGatewayCatalogStore();
  const config = useGatewayConfigStore();
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  const refreshViewEpoch = views.viewEpoch;
  const sessionIsCurrent = () => auth.isCurrentSession(sessionEpoch);

  bootstrap.initializing = true;
  views.loading = true;
  bootstrap.clearError();
  try {
    const routeSelection = readGatewayRouteSelection();
    useGatewayRealtimeStore().connectHostLifecycleEvents();
    catalog.projects = [];
    catalog.projectDirectoryAvailability = {};
    navigation.threads = [];
    catalog.models = [];
    catalog.modelsHostId = null;
    if (!(await config.loadConfigFromServer()) || !sessionIsCurrent()) return;

    const routeHostExists =
      routeSelection.hostId !== null
        ? catalog.hosts.some((host) => host.id === routeSelection.hostId)
        : false;
    if (routeHostExists) navigation.selectedHostId = routeSelection.hostId;
    else if (navigation.selectedHostId === null) {
      navigation.selectedHostId = catalog.hosts[0]?.id ?? null;
    }
    navigation.selectedProjectId = routeHostExists ? routeSelection.projectId : null;
    navigation.selectedThreadId = routeHostExists ? routeSelection.threadId : null;
    views.resetCurrentView();

    const viewUnchanged = () => sessionIsCurrent() && views.viewEpoch === refreshViewEpoch;
    if (
      routeHostExists &&
      routeSelection.hostId !== null &&
      routeSelection.threadId !== null &&
      viewUnchanged()
    ) {
      bootstrap.initializing = false;
      views.loading = false;
      await views.openThread(routeSelection.threadId, {
        hostId: routeSelection.hostId,
        projectId: routeSelection.projectId,
        replaceRoute: true,
      });
      hydrateNavigationDataInBackground(sessionEpoch);
    } else {
      await hydrateNavigationData(sessionEpoch);
      if (
        !hasGatewayRouteSelection(routeSelection) &&
        viewUnchanged() &&
        (await views.restoreLastOpenThread())
      ) {
        // Browser-local route selection was restored by the view owner.
      } else if (viewUnchanged()) {
        writeGatewayRouteSelection(
          {
            hostId: navigation.selectedHostId,
            projectId: navigation.selectedProjectId,
            threadId: null,
          },
          { replace: true },
        );
      }
    }
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return;
    bootstrap.setError(
      messageFromError(error, bootstrap.t("app.bootstrapFailed"), bootstrap.errorLabels),
      {
        hostId: navigation.selectedHostId,
        projectId: navigation.selectedProjectId,
        threadId: navigation.selectedThreadId,
      },
    );
  } finally {
    if (sessionIsCurrent()) {
      views.loading = false;
      bootstrap.initializing = false;
    }
  }
}

async function hydrateNavigationData(sessionEpoch: number) {
  const auth = useAuthStore();
  const catalog = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const anchor = navigationHydrationAnchor();
  const canContinue = () =>
    auth.isCurrentSession(sessionEpoch) && canContinueNavigationHydration(anchor);
  await navigation.connectAllHosts();
  if (!canContinue()) return;
  await catalog.listModels();
  if (!canContinue()) return;
  await navigation.listThreads();
  if (!canContinue()) return;
  if (navigation.selectedProjectId === null) catalog.ensureSelectedProject();
  if (canContinue() && navigation.selectedProjectId !== null) await navigation.listThreads();
}

function hydrateNavigationDataInBackground(sessionEpoch: number) {
  void hydrateNavigationData(sessionEpoch).catch((error: unknown) => {
    const auth = useAuthStore();
    if (!auth.isCurrentSession(sessionEpoch)) return;
    const bootstrap = useGatewayBootstrapStore();
    const navigation = useGatewayNavigationStore();
    bootstrap.setError(
      messageFromError(error, bootstrap.t("app.bootstrapFailed"), bootstrap.errorLabels),
      {
        hostId: navigation.selectedHostId,
        projectId: navigation.selectedProjectId,
        threadId: navigation.selectedThreadId,
      },
    );
  });
}

function navigationHydrationAnchor() {
  const navigation = useGatewayNavigationStore();
  return { hostId: navigation.selectedHostId, threadId: navigation.selectedThreadId };
}

function canContinueNavigationHydration(anchor: ReturnType<typeof navigationHydrationAnchor>) {
  const catalog = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  return (
    navigation.selectedHostId === anchor.hostId &&
    navigation.selectedThreadId === anchor.threadId &&
    (anchor.hostId === null || catalog.hosts.some((host) => host.id === anchor.hostId))
  );
}
