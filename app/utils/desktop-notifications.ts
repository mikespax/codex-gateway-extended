import type { ServerNotification } from "~~/shared/types";

const DESKTOP_NOTIFICATION_PREFERENCE_KEY = "codex-gateway.desktop-notifications";
const MAX_SHOWN_NOTIFICATION_KEYS = 128;

const shownNotificationKeys = new Set<string>();

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isDesktopNotificationsSupported() {
  return isBrowser() && "Notification" in window;
}

export function desktopNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isDesktopNotificationsSupported()) return "unsupported";
  return window.Notification.permission;
}

export function isDesktopNotificationsEnabled() {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(DESKTOP_NOTIFICATION_PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDesktopNotificationsEnabled(enabled: boolean) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(DESKTOP_NOTIFICATION_PREFERENCE_KEY, enabled ? "1" : "0");
  } catch {
    // A locked-down browser may deny local storage. Permission remains authoritative.
  }
}

/** Request Notification Center permission from an explicit settings-button gesture. */
export async function requestDesktopNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!isDesktopNotificationsSupported()) return "unsupported";

  try {
    const permission = await window.Notification.requestPermission();
    setDesktopNotificationsEnabled(permission === "granted");
    return permission;
  } catch {
    return window.Notification.permission;
  }
}

/**
 * Show a native desktop notification for a completed turn when the Gateway is not the focused
 * window. The in-app toast and completion chime cover the focused-window case.
 */
export function showDesktopTurnCompletionNotification(notification: ServerNotification) {
  if (
    !isBrowser() ||
    !isDesktopNotificationsEnabled() ||
    desktopNotificationPermission() !== "granted" ||
    shownNotificationKeys.has(notification.key) ||
    (document.visibilityState === "visible" && document.hasFocus())
  ) {
    return false;
  }

  const nativeNotification = new window.Notification(notification.title, {
    body: notification.body,
    tag: `codex-gateway:${notification.key}`,
    silent: true,
  });
  nativeNotification.onclick = () => {
    window.focus();
    nativeNotification.close();
  };

  shownNotificationKeys.add(notification.key);
  if (shownNotificationKeys.size > MAX_SHOWN_NOTIFICATION_KEYS) {
    const oldest = shownNotificationKeys.values().next().value;
    if (oldest !== undefined) shownNotificationKeys.delete(oldest);
  }
  return true;
}

export async function testDesktopNotification() {
  if (!isDesktopNotificationsSupported()) return false;
  if (desktopNotificationPermission() !== "granted") {
    const permission = await requestDesktopNotificationPermission();
    if (permission !== "granted") return false;
  }

  const key = `settings-test-${Date.now()}`;
  const previousVisibility = document.visibilityState;
  if (previousVisibility === "visible" && document.hasFocus()) {
    // Test notifications are explicitly requested by the user, so they should be visible even
    // while Settings is in the foreground. Completion notifications remain background-only.
    const nativeNotification = new window.Notification("Codex Gateway", {
      body: "Desktop notifications are enabled.",
      tag: `codex-gateway:${key}`,
      silent: true,
    });
    nativeNotification.onclick = () => {
      window.focus();
      nativeNotification.close();
    };
    return true;
  }

  return showDesktopTurnCompletionNotification({
    key,
    title: "Codex Gateway",
    body: "Desktop notifications are enabled.",
    target: { kind: "thread", hostId: 0, projectId: null, threadId: "settings" },
  });
}
