import { createHash } from "node:crypto";
import type { BarkNotificationSettings } from "~~/shared/types";
import type { ServerNotification } from "~~/shared/types";
import { firstNonEmptyString } from "~~/shared/utils/strings";

const BARK_REQUEST_TIMEOUT_MS = 10_000;

export class BarkRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BarkRequestError";
  }
}

export async function sendBarkNotification(
  settings: BarkNotificationSettings,
  notification: ServerNotification,
) {
  const url = buildBarkUrl(settings, notification);
  await sendBarkRequest(url);
}

async function sendBarkRequest(url: URL) {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(BARK_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new BarkRequestError(
      // Do not include the provider response body. Some Bark-compatible servers echo the
      // configured device key in an error, and this message is logged by the notification
      // dispatcher. The HTTP status is sufficient for retry classification and diagnostics.
      `Bark notification failed with HTTP ${response.status}`,
      retryable,
    );
  }
}

function buildBarkUrl(settings: BarkNotificationSettings, notification: ServerNotification) {
  const base = settings.serverUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/${encodeURIComponent(settings.deviceKey)}/${encodeURIComponent(notification.title)}/${encodeURIComponent(notification.body)}`,
  );
  const group = firstNonEmptyString([notification.group, settings.group]);
  if (group !== null) {
    url.searchParams.set("group", group);
  }
  // Bark forwards id as the APNs collapse identifier, whose UTF-8 representation is limited to
  // 64 bytes. Gateway keys deliberately contain scope and event details and routinely exceed that
  // limit, so never pass them through directly. A stable SHA-256 base64url digest retains retry
  // idempotency in 43 ASCII bytes without leaking thread identifiers to the push provider.
  url.searchParams.set("id", barkNotificationId(notification.key));
  return url;
}

function barkNotificationId(key: string) {
  return createHash("sha256").update(key).digest("base64url");
}
