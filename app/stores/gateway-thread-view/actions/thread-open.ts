import type { ComposerTurnOptions, ThreadHistoryState } from "~~/shared/types";
import { INITIAL_TURN_PAGE_LIMIT } from "~~/shared/config";
import { threadTurnsFromHistory } from "~~/shared/thread-history/shape";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import {
  applyStartedThreadResult,
  applyThreadSnapshotResult,
} from "@/stores/gateway/thread-open/hydration";
import {
  requestActivateThreadSnapshot,
  requestStartThread,
} from "@/stores/gateway/thread-open/transport";
import { messageFromError, pinnedKey } from "@/stores/gateway/thread-utils/identity";
import {
  activateThreadView,
  activatePendingThreadView,
  beginViewTransition,
  cacheSelectedThreadView,
  clearCurrentThreadView,
  isCurrentViewTransition,
  rememberOpenThread,
  requestScrollToLatest,
  restoreThreadView,
  syncSelectedRoute,
} from "@/stores/gateway/thread-open/view-state";
import { patchThreadView, upsertThreadView } from "@/stores/gateway/thread-open/thread-view-cache";
import { readPersistentThreadView } from "@/stores/gateway/thread-open/persistent-thread-view-cache";
import { clearThreadCompletionAttention } from "@/stores/gateway/thread-runtime/completion-attention";
import { captureSessionEpoch } from "@/utils/session-epoch";

const previewLoadTokens = new Map<string, symbol>();
interface EventGapRecovery {
  promise: Promise<void>;
  sessionIsCurrent: () => boolean;
}

const eventGapRecoveries = new Map<string, EventGapRecovery>();

export function invalidateThreadPreviewLoad(hostId: number, threadId: string) {
  // Deleting the ownership token invalidates an in-flight response without retaining one
  // generation counter for every subagent ever opened during this page lifetime.
  previewLoadTokens.delete(pinnedKey(hostId, threadId));
}

export function createThreadOpenActions() {
  return {
    beginViewTransition,
    isCurrentViewTransition,
    cacheSelectedThreadView,
    restoreThreadView,
    clearCurrentThreadView,
    rememberOpenThread,
    requestScrollToLatest,
    syncSelectedRoute,

    async openThread(
      threadId: string,
      context?: { hostId?: number; projectId?: number | null; replaceRoute?: boolean },
    ) {
      const gateway = useGatewayCatalogStore();
      const navigation = useGatewayNavigationStore();
      const views = useGatewayThreadViewStore();
      cacheSelectedThreadView();
      const targetHostId = context?.hostId ?? navigation.selectedHostId;
      const targetProjectId =
        context && "projectId" in context
          ? (context.projectId ?? null)
          : navigation.selectedProjectId;
      if (targetHostId === null || targetHostId === undefined) return;
      clearThreadCompletionAttention(targetHostId, threadId);
      if (
        navigation.selectedHostId === targetHostId &&
        navigation.selectedThreadId === threadId &&
        views.currentThread !== null &&
        views.history !== null
      ) {
        void gateway.ensureSelectedHostModels();
        finishThreadSelection(threadId, context?.replaceRoute);
        void refreshGoalAfterOpen(targetHostId, threadId);
        requestScrollToLatest();
        return;
      }
      const viewEpoch = beginViewTransition();
      if (gateway.modelsHostId !== targetHostId) {
        gateway.models = [];
        gateway.modelsHostId = null;
      }
      activatePendingThreadView(targetHostId, targetProjectId, threadId);
      void gateway.ensureSelectedHostModels();
      if (restoreThreadView(targetHostId, threadId)) {
        const cachedTurnLimit = Math.max(
          INITIAL_TURN_PAGE_LIMIT,
          threadTurnsFromHistory(views.history).length,
        );
        finishThreadSelection(threadId, context?.replaceRoute);
        void refreshGoalAfterOpen(targetHostId, threadId);
        requestScrollToLatest();
        void syncOpenThreadFromServer({
          hostId: targetHostId,
          projectId: targetProjectId,
          threadId,
          viewEpoch,
          replaceRoute: context?.replaceRoute,
          showLoading: false,
          scrollToLatest: false,
          limit: cachedTurnLimit,
        });
        return;
      }
      const sessionIsCurrent = captureSessionEpoch();
      const persistentView = await readPersistentThreadView(targetHostId, threadId);
      if (
        persistentView !== null &&
        sessionIsCurrent() &&
        isCurrentViewTransition(viewEpoch) &&
        navigation.selectedHostId === targetHostId &&
        navigation.selectedThreadId === threadId
      ) {
        upsertThreadView(persistentView);
        restoreThreadView(targetHostId, threadId);
        const cachedTurnLimit = Math.max(
          INITIAL_TURN_PAGE_LIMIT,
          threadTurnsFromHistory(persistentView.history).length,
        );
        rememberOpenThread(threadId);
        syncSelectedRoute({ replace: context?.replaceRoute });
        requestScrollToLatest();
        void syncOpenThreadFromServer({
          hostId: targetHostId,
          projectId: persistentView.projectId ?? targetProjectId,
          threadId,
          viewEpoch,
          replaceRoute: context?.replaceRoute,
          showLoading: false,
          scrollToLatest: false,
          limit: cachedTurnLimit,
        });
        return;
      }
      await syncOpenThreadFromServer({
        hostId: targetHostId,
        projectId: targetProjectId,
        threadId,
        viewEpoch,
        replaceRoute: context?.replaceRoute,
        showLoading: true,
      });
    },

    async openThreadPreview(
      hostId: number,
      threadId: string,
      context: { projectId?: number | null; limit?: number } = {},
    ) {
      const gateway = useGatewayBootstrapStore();
      const views = useGatewayThreadViewStore();
      const key = pinnedKey(hostId, threadId);
      const existing = views.threadViews[key];
      if (
        existing?.history !== null &&
        existing?.history !== undefined &&
        (existing.error === null || existing.error === undefined || existing.error === "")
      ) {
        useGatewayRealtimeStore().connectThreadEvents(
          hostId,
          threadId,
          existing.lastEventId,
          existing.eventEpoch,
        );
        return existing;
      }
      const loadToken = beginPreviewLoad(key);
      const sessionIsCurrent = captureSessionEpoch();
      patchThreadView(hostId, threadId, {
        ...(existing ?? { projectId: context.projectId ?? null }),
        loading: true,
        error: null,
      });
      try {
        const result = await requestActivateThreadSnapshot({
          hostId,
          projectId: context.projectId ?? null,
          threadId,
          limit: context.limit ?? INITIAL_TURN_PAGE_LIMIT,
        });
        if (!sessionIsCurrent()) return undefined;
        if (previewLoadTokens.get(key) !== loadToken) {
          // thread.activate subscribes upstream before returning its snapshot. If the owning
          // panel disappeared while awaiting it, explicitly release that late subscription.
          // A newer generation may represent a reopened panel and owns the same app-server
          // subscription, so the obsolete response must not unsubscribe that replacement.
          const panelStillOpen = views.subAgentPanels.some(
            (panel) => pinnedKey(panel.hostId, panel.threadId) === key,
          );
          if (!panelStillOpen) useGatewayRealtimeStore().cancelThreadEvents(hostId, threadId);
          return undefined;
        }
        upsertThreadView({
          hostId,
          projectId: result.projectId ?? context.projectId ?? null,
          threadId,
          currentThread: result.thread,
          history: result.history,
          timelineTurns: result.history.thread.turns,
          events: [...result.recentEvents],
          olderTurnsCursor: result.turnsPage.nextCursor,
          newerTurnsCursor: result.turnsPage.backwardsCursor,
          lastEventId: result.lastEventId,
          eventEpoch: result.eventEpoch,
          loading: false,
          error: null,
        });
        useGatewayRealtimeStore().rememberThreadSubscription(
          hostId,
          threadId,
          result.lastEventId,
          result.eventEpoch,
        );
        return views.threadViews[key];
      } catch (error: unknown) {
        if (!sessionIsCurrent()) return undefined;
        if (previewLoadTokens.get(key) !== loadToken) return undefined;
        patchThreadView(hostId, threadId, {
          projectId: context.projectId ?? existing?.projectId ?? null,
          loading: false,
          error: messageFromError(error, gateway.t("app.openThreadFailed"), gateway.errorLabels),
        });
        throw error;
      } finally {
        // Compare identity before deleting: a reopened panel may already own a newer request.
        // The obsolete request must neither clear that token nor unsubscribe its replacement.
        if (previewLoadTokens.get(key) === loadToken) previewLoadTokens.delete(key);
      }
    },

    async refreshSelectedThreadSnapshot(
      options: { showLoading?: boolean; scrollToLatest?: boolean } = {},
    ) {
      const gateway = useGatewayBootstrapStore();
      const navigation = useGatewayNavigationStore();
      const views = useGatewayThreadViewStore();
      const hostId = navigation.selectedHostId;
      const projectId = navigation.selectedProjectId;
      const threadId = navigation.selectedThreadId;
      if (hostId === null || threadId === null || threadId === "") return;
      const viewEpoch = views.viewEpoch;
      const sessionIsCurrent = captureSessionEpoch();
      const limit = retainedTurnLimit(views.history);
      if (options.showLoading === true) views.loading = true;
      try {
        const result = await requestActivateThreadSnapshot({
          hostId,
          projectId,
          threadId,
          limit,
        });
        if (
          !sessionIsCurrent() ||
          views.viewEpoch !== viewEpoch ||
          navigation.selectedHostId !== hostId ||
          navigation.selectedThreadId !== threadId ||
          (result.eventEpoch === views.eventEpoch && result.lastEventId < views.lastEventId)
        )
          return;
        applyThreadSnapshotResult(threadId, result);
        cacheSelectedThreadView();
        useGatewayRealtimeStore().rememberThreadSubscription(
          hostId,
          threadId,
          result.lastEventId,
          result.eventEpoch,
        );
        void refreshGoalAfterOpen(hostId, threadId);
        if (options.scrollToLatest === true) requestScrollToLatest();
      } catch (error: unknown) {
        if (!sessionIsCurrent()) return;
        gateway.setError(
          messageFromError(error, gateway.t("app.openThreadFailed"), gateway.errorLabels),
          { hostId, projectId, threadId },
        );
      } finally {
        if (options.showLoading === true && sessionIsCurrent()) views.loading = false;
      }
    },

    recoverThreadEventGap(hostId: number, threadId: string) {
      const key = pinnedKey(hostId, threadId);
      const pending = eventGapRecoveries.get(key);
      if (pending !== undefined && pending.sessionIsCurrent()) return pending.promise;
      const sessionIsCurrent = captureSessionEpoch();
      const recovery = recoverThreadSnapshot(hostId, threadId).finally(() => {
        if (eventGapRecoveries.get(key)?.promise === recovery) eventGapRecoveries.delete(key);
      });
      eventGapRecoveries.set(key, { promise: recovery, sessionIsCurrent });
      return recovery;
    },

    async restoreLastOpenThread() {
      const gateway = useGatewayCatalogStore();
      const navigation = useGatewayNavigationStore();
      const last = navigation.lastOpenThread;
      if (
        last.hostId === null ||
        last.threadId === null ||
        last.threadId === "" ||
        !gateway.hosts.some((host) => host.id === last.hostId)
      ) {
        return false;
      }
      navigation.selectedHostId = last.hostId;
      navigation.selectedProjectId = last.projectId;
      await useGatewayThreadViewStore().openThread(last.threadId, {
        hostId: last.hostId,
        projectId: last.projectId,
        replaceRoute: true,
      });
      syncSelectedRoute({ replace: true });
      return true;
    },

    async startThread(
      options: ComposerTurnOptions = {},
      context?: { hostId?: number; projectId?: number | null },
    ) {
      const gateway = useGatewayBootstrapStore();
      const navigation = useGatewayNavigationStore();
      cacheSelectedThreadView();
      const viewEpoch = beginViewTransition();
      if (context?.hostId !== undefined)
        activateThreadView(context.hostId, context.projectId ?? null);
      else if (context && "projectId" in context) {
        navigation.selectedProjectId = context.projectId ?? null;
        clearCurrentThreadView();
      }
      if (navigation.selectedHostId === null) return;
      const sessionIsCurrent = captureSessionEpoch();
      const hostId = navigation.selectedHostId;
      const projectId = navigation.selectedProjectId;
      try {
        const result = await requestStartThread(options);
        if (!sessionIsCurrent() || !isCurrentViewTransition(viewEpoch)) return;
        const threadId = applyStartedThreadResult(result);
        cacheSelectedThreadView();
        rememberOpenThread(threadId);
        syncSelectedRoute();
        useGatewayRealtimeStore().connectThreadEvents(
          navigation.selectedHostId,
          threadId,
          useGatewayThreadViewStore().lastEventId,
          useGatewayThreadViewStore().eventEpoch,
        );

        // Creating the thread is the authoritative state transition. Commit its selection and URL
        // before refreshing the sidebar catalog: that secondary RPC may be slow while a host has
        // just upgraded/restarted, but it must not leave a successfully created thread unreachable.
        await navigation.listThreads();
        cacheSelectedThreadView();
      } catch (error: unknown) {
        if (!sessionIsCurrent() || !isCurrentViewTransition(viewEpoch)) return;
        gateway.setError(
          messageFromError(error, gateway.t("app.openThreadFailed"), gateway.errorLabels),
          { hostId, projectId, threadId: navigation.selectedThreadId },
        );
      }
    },
  };
}

async function recoverThreadSnapshot(hostId: number, threadId: string) {
  const gateway = useGatewayBootstrapStore();
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  const key = pinnedKey(hostId, threadId);
  const existing = views.threadViews[key];
  const selected = navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId;
  if (existing === undefined && !selected) {
    useGatewayRealtimeStore().cancelThreadEvents(hostId, threadId);
    return;
  }

  const sessionIsCurrent = captureSessionEpoch();
  const limit = retainedTurnLimit(selected ? views.history : (existing?.history ?? null));
  try {
    const result = await requestActivateThreadSnapshot({
      hostId,
      projectId: existing?.projectId ?? navigation.selectedProjectId,
      threadId,
      limit,
    });
    if (!sessionIsCurrent()) return;
    const stillSelected =
      navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId;
    const retainedView = views.threadViews[key];
    if (!stillSelected && retainedView === undefined) {
      useGatewayRealtimeStore().cancelThreadEvents(hostId, threadId);
      return;
    }

    if (stillSelected) {
      // A gap is an explicit declaration that incremental state is incomplete. Replace it with
      // the authoritative snapshot even if its event id is lower after a server restart; the
      // ordinary refresh path intentionally rejects lower ids and is therefore not suitable here.
      applyThreadSnapshotResult(threadId, result);
      cacheSelectedThreadView();
    } else {
      upsertThreadView({
        hostId,
        projectId: result.projectId ?? retainedView?.projectId ?? null,
        threadId,
        currentThread: result.thread,
        history: result.history,
        timelineTurns: result.history.thread.turns,
        events: [...result.recentEvents],
        olderTurnsCursor: result.turnsPage.nextCursor,
        newerTurnsCursor: result.turnsPage.backwardsCursor,
        lastEventId: result.lastEventId,
        eventEpoch: result.eventEpoch,
        loading: false,
        error: null,
      });
    }
    useGatewayRealtimeStore().rememberThreadSubscription(
      hostId,
      threadId,
      result.lastEventId,
      result.eventEpoch,
    );
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return;
    gateway.setError(
      messageFromError(error, gateway.t("app.openThreadFailed"), gateway.errorLabels),
      { hostId, threadId, projectId: existing?.projectId ?? null },
    );
  }
}

function beginPreviewLoad(key: string) {
  const token = Symbol(key);
  previewLoadTokens.set(key, token);
  return token;
}

async function syncOpenThreadFromServer(input: {
  hostId: number;
  projectId: number | null;
  threadId: string;
  viewEpoch: number;
  replaceRoute?: boolean;
  showLoading: boolean;
  scrollToLatest?: boolean;
  limit?: number;
}) {
  const gateway = useGatewayBootstrapStore();
  const views = useGatewayThreadViewStore();
  const sessionIsCurrent = captureSessionEpoch();
  if (input.showLoading) views.loading = true;
  gateway.clearError();
  try {
    const result = await requestActivateThreadSnapshot(input);
    if (
      !sessionIsCurrent() ||
      !isCurrentViewTransition(input.viewEpoch) ||
      (result.eventEpoch === views.eventEpoch && result.lastEventId < views.lastEventId)
    )
      return;
    applyThreadSnapshotResult(input.threadId, result);
    cacheSelectedThreadView();
    finishThreadSelection(input.threadId, input.replaceRoute);
    void refreshGoalAfterOpen(input.hostId, input.threadId);
    if (input.scrollToLatest ?? true) requestScrollToLatest();
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return;
    gateway.setError(
      messageFromError(error, gateway.t("app.openThreadFailed"), gateway.errorLabels),
      { hostId: input.hostId, projectId: input.projectId, threadId: input.threadId },
    );
  } finally {
    if (input.showLoading && sessionIsCurrent()) views.loading = false;
  }
}

function finishThreadSelection(threadId: string, replaceRoute?: boolean) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  rememberOpenThread(threadId);
  syncSelectedRoute({ replace: replaceRoute });
  if (navigation.selectedHostId !== null) {
    useGatewayRealtimeStore().connectThreadEvents(
      navigation.selectedHostId,
      threadId,
      views.lastEventId,
      views.eventEpoch,
    );
  }
}

async function refreshGoalAfterOpen(hostId: number, threadId: string) {
  const sessionIsCurrent = captureSessionEpoch();
  const gateway = useGatewayBootstrapStore();
  const composer = useGatewayComposerStore();
  const navigation = useGatewayNavigationStore();
  try {
    const key = pinnedKey(hostId, threadId);
    if (
      !(key in composer.threadGoalObservedAtByKey) &&
      navigation.selectedHostId === hostId &&
      navigation.selectedThreadId === threadId
    ) {
      await composer.refreshSelectedThreadGoal();
    }
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return;
    gateway.setError(
      messageFromError(error, gateway.t("app.refreshThreadGoalFailed"), gateway.errorLabels),
      { hostId, threadId, projectId: navigation.selectedProjectId },
    );
  }
}

function retainedTurnLimit(history: ThreadHistoryState | null) {
  return Math.max(INITIAL_TURN_PAGE_LIMIT, threadTurnsFromHistory(history).length);
}
