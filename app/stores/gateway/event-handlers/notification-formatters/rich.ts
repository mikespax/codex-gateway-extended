import { jsonPreview } from "@/utils/thread-items";
import { recordFromUnknown } from "~~/shared/utils/records";
import {
  count,
  list,
  simpleNotification,
  text,
  withDetails,
  type FormattedNotification,
  type TranslationFunction,
} from "./common";
import {
  categoryRecordSchema,
  externalImportResultsSchema,
  guardianReviewSchema,
  hookRunSchema,
  rateLimitsSchema,
} from "./schemas";

export function hookNotification(
  t: TranslationFunction,
  params: Record<string, unknown>,
  key: string,
) {
  const run = hookRunSchema.safeParse(params.run).data ?? {};
  return withDetails(
    simpleNotification(t, key, run.status === "failed" ? "warning" : "info", {
      event: text(run.eventName),
      status: text(run.status),
      message: text(run.statusMessage),
    }),
    Array.isArray(run.entries) && run.entries.length > 0 ? jsonPreview(run.entries) : null,
  );
}

export function guardianReviewNotification(
  t: TranslationFunction,
  params: Record<string, unknown>,
  phase: "started" | "completed",
) {
  const review = guardianReviewSchema.safeParse(params.review).data ?? {};
  return withDetails(
    simpleNotification(
      t,
      phase === "started" ? "guardianReviewStarted" : "guardianReviewCompleted",
      "info",
      {
        action: text(params.action),
        status: text(review.status),
        risk: text(review.riskLevel),
        rationale: text(review.rationale),
      },
    ),
    jsonPreview({
      reviewId: params.reviewId,
      targetItemId: params.targetItemId,
      decisionSource: params.decisionSource,
      userAuthorization: review.userAuthorization,
    }),
  );
}

export function rateLimitsUpdatedNotification(
  t: TranslationFunction,
  params: Record<string, unknown>,
) {
  const limits = rateLimitsSchema.safeParse(params.rateLimits).data ?? {};
  const reached = text(limits.rateLimitReachedType);
  const limitName = text(limits.limitName);
  return withDetails(
    simpleNotification(t, "accountRateLimitsUpdated", reached !== "" ? "warning" : "info", {
      plan: text(limits.planType),
      limit: limitName !== "" ? limitName : text(limits.limitId),
      reached,
    }),
    jsonPreview(limits),
  );
}

export function externalAgentConfigImportNotification(
  t: TranslationFunction,
  params: Record<string, unknown>,
  key: string,
) {
  const parsedResults = externalImportResultsSchema.safeParse(params.itemTypeResults);
  const results = parsedResults.success ? parsedResults.data : [];
  const successes = results.reduce((total, result) => total + count(result.successes), 0);
  const failures = results.reduce((total, result) => total + count(result.failures), 0);
  return withDetails(
    simpleNotification(t, key, failures > 0 ? "warning" : "info", { successes, failures }),
    jsonPreview(results),
  );
}

export function moderationMetadataNotification(
  t: TranslationFunction,
  params: Record<string, unknown>,
): FormattedNotification {
  const metadata = params.metadata;
  const summary = moderationSummary(metadata);
  return withDetails(
    simpleNotification(t, "turnModerationMetadata", "info", { summary }),
    jsonPreview(metadata),
  );
}

export function modelSafetyBufferingNotification(
  t: TranslationFunction,
  params: Record<string, unknown>,
) {
  return withDetails(
    simpleNotification(
      t,
      params.showBufferingUi === true
        ? "modelSafetyBufferingEnabled"
        : "modelSafetyBufferingDisabled",
      "info",
      {
        model: text(params.model),
        fasterModel: text(params.fasterModel),
        reasons: list(params.reasons, 3),
        useCases: list(params.useCases, 3),
      },
    ),
    jsonPreview({
      useCases: params.useCases,
      reasons: params.reasons,
      fasterModel: params.fasterModel,
    }),
  );
}

export function warningNotification(
  t: TranslationFunction,
  key: string,
  params: Record<string, unknown>,
) {
  return simpleNotification(t, key, "warning", { message: text(params.message) });
}

function moderationSummary(metadata: unknown) {
  const record = recordFromUnknown(metadata);
  if (record === null) {
    const summary = text(metadata);
    return summary !== "" ? summary : "metadata";
  }
  const flagged = findFirst(record, ["flagged", "blocked", "unsafe", "moderated"]);
  const model = findFirst(record, ["model", "moderationModel", "classifier"]);
  const categoryKeys = extractCategoryKeys(record);
  return [
    flagged === undefined ? "" : `flagged=${text(flagged)}`,
    text(model) !== "" ? `model=${text(model)}` : "",
    categoryKeys.length > 0 ? `categories=${categoryKeys.slice(0, 4).join(", ")}` : "",
    `keys=${Object.keys(record).slice(0, 6).join(", ")}`,
  ]
    .filter((value) => value !== "")
    .join(" · ");
}

function extractCategoryKeys(record: Record<string, unknown>) {
  const categories = findFirst(record, ["categories", "category_scores", "categoryScores"]);
  const parsed = categoryRecordSchema.safeParse(categories);
  if (parsed.success) {
    return Object.entries(parsed.data)
      .filter(([, value]) => text(value) !== "")
      .map(([key]) => key);
  }
  return [];
}

function findFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}
