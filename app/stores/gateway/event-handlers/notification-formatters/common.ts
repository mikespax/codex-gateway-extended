import { jsonPreview } from "@/utils/thread-items";
import { recordFromUnknown } from "~~/shared/utils/records";
export type TranslationFunction = (key: string, values?: Record<string, unknown>) => string;

export interface FormattedNotification {
  title: string;
  message: string;
  details?: string;
  level?: "info" | "warning";
}

export interface NotificationFormatContext {
  hostId: number;
  threadId: string;
}

export type NotificationFormatter = (
  t: TranslationFunction,
  params: Record<string, unknown>,
  context?: NotificationFormatContext,
) => FormattedNotification;

export function simpleNotification(
  t: TranslationFunction,
  key: string,
  level: "info" | "warning" = "info",
  values: Record<string, unknown> = {},
): FormattedNotification {
  return {
    title: t(`app.notifications.${key}.title`, values),
    message: t(`app.notifications.${key}.message`, values),
    level,
  };
}

export function withDetails(notification: FormattedNotification, details: unknown) {
  const detailsText = text(details);
  return detailsText !== "" ? { ...notification, details: detailsText } : notification;
}

export function verificationSummary(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }
  return value
    .slice(0, 3)
    .map((item) => {
      const record = recordFromUnknown(item);
      if (record === null) return text(item);
      return (
        [record.status, record.result, record.model, record.id]
          .map(text)
          .find((candidate) => candidate !== "") ?? text(item)
      );
    })
    .filter((value) => value !== "")
    .join(", ");
}

export function itemSummary(item: unknown) {
  const record = recordFromUnknown(item);
  if (record === null) return text(item);
  return [text(record.type), text(record.id)].filter((value) => value !== "").join(" · ");
}

export function goalSummary(goal: unknown) {
  const record = recordFromUnknown(goal);
  if (record === null) return text(goal);
  return (
    [record.summary, record.text, record.title, record.name]
      .map(text)
      .find((value) => value !== "") ?? text(goal)
  );
}

export function configRange(range: unknown) {
  if (recordFromUnknown(range) === null) {
    return "";
  }
  return jsonPreview(range);
}

export function list(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return text(value);
  }
  const visible = value
    .slice(0, limit)
    .map(text)
    .filter((item) => item !== "");
  const extra = value.length - visible.length;
  return extra > 0 ? `${visible.join(", ")} +${extra}` : visible.join(", ");
}

export function count(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

export function text(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return jsonPreview(value);
}
