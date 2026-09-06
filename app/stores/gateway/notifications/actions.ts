import type { ServerNotification, ServerNotificationTarget } from "~~/shared/types";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";
import { match } from "ts-pattern";

type NotificationAction = { labelKey: string; run: () => void };
type TargetFor<K extends ServerNotificationTarget["kind"]> = Extract<
  ServerNotificationTarget,
  { kind: K }
>;

function threadAction(target: TargetFor<"thread">): NotificationAction {
  return {
    labelKey: "app.openThread",
    run: () => {
      void useGatewayThreadViewStore().openThread(target.threadId, {
        hostId: target.hostId,
        projectId: target.projectId,
      });
    },
  };
}

function tmuxMonitorAction(target: TargetFor<"tmuxMonitor">): NotificationAction {
  return {
    labelKey: "app.openTmuxMonitor",
    run: () => {
      void openTmuxMonitor(target);
    },
  };
}

export function notificationAction(notification: ServerNotification) {
  return match(notification.target)
    .with({ kind: "thread" }, threadAction)
    .with({ kind: "tmuxMonitor" }, tmuxMonitorAction)
    .exhaustive();
}

export function projectPublishedNotification(notification: ServerNotification) {
  if (notification.target.kind !== "tmuxMonitor") return;
  useGatewayTmuxStore().handleCompletion(notification.target.monitorId);
}

async function openTmuxMonitor(target: TargetFor<"tmuxMonitor">) {
  if (target.threadId !== null) {
    await useGatewayThreadViewStore().openThread(target.threadId, {
      hostId: target.hostId,
      projectId: target.projectId,
    });
  } else if (useGatewayNavigationStore().selectedHostId !== target.hostId) {
    await useGatewayCatalogStore().selectHost(target.hostId);
  }
  useGatewayTmuxStore().openPanel({ monitorId: target.monitorId });
}
