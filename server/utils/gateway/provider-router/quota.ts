type ProviderQuotaState = "available" | "exhausted" | "unknown";

export type UpstreamFailureKind =
  | "quota_exhausted"
  | "rate_limit"
  | "authentication"
  | "temporary"
  | "context_overflow"
  | "invalid_request"
  | "model_unavailable"
  | "unknown";

export interface ClassifiedUpstreamFailure {
  kind: UpstreamFailureKind;
  quotaState: ProviderQuotaState;
  retryable: boolean;
  reasonCode: string;
  /** A provider-supplied reset time is optional and only populated for explicit quota errors. */
  resetAt: string | null;
}

/** Only unambiguous usage-allocation failures may poison the persistent OpenAI quota state. */
export function classifyOpenAiFailure(error: unknown): ClassifiedUpstreamFailure {
  const record = asRecord(error);
  const errorMessage = error instanceof Error ? error.message : null;
  const status = numberValue(record?.status ?? record?.statusCode ?? record?.httpStatus);
  const code = stringValue(record?.code ?? record?.errorCode)?.toLowerCase() ?? "";
  const message = [
    stringValue(record?.message),
    errorMessage,
    stringValue(asRecord(record?.error)?.message),
    stringValue(asRecord(record?.data)?.message),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    code.includes("insufficient_quota") ||
    code.includes("quota_exhaust") ||
    /(?:usage|subscription|plan|allowance).*(?:exhaust|deplet|limit)|quota.*(?:exceed|limit)/i.test(
      message,
    )
  ) {
    return {
      kind: "quota_exhausted",
      quotaState: "exhausted",
      retryable: false,
      reasonCode: code || "quota_exhausted",
      resetAt: quotaResetAt(error),
    };
  }
  if (
    status === 429 ||
    code.includes("rate_limit") ||
    /rate limit|too many requests/i.test(message)
  ) {
    return {
      kind: "rate_limit",
      quotaState: "unknown",
      retryable: true,
      reasonCode: "rate_limit",
      resetAt: null,
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid.*(?:api|auth)|unauthori[sz]ed|forbidden/i.test(message)
  ) {
    return {
      kind: "authentication",
      quotaState: "unknown",
      retryable: false,
      reasonCode: "authentication",
      resetAt: null,
    };
  }
  if (/context|token limit|too many tokens|maximum context/i.test(message)) {
    return {
      kind: "context_overflow",
      quotaState: "unknown",
      retryable: false,
      reasonCode: "context_overflow",
      resetAt: null,
    };
  }
  if (/invalid request|bad request|schema|malformed/i.test(message) || status === 400) {
    return {
      kind: "invalid_request",
      quotaState: "unknown",
      retryable: false,
      reasonCode: "invalid_request",
      resetAt: null,
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      kind: "temporary",
      quotaState: "unknown",
      retryable: true,
      reasonCode: "temporary",
      resetAt: null,
    };
  }
  return {
    kind: "unknown",
    quotaState: "unknown",
    retryable: false,
    reasonCode: "unknown",
    resetAt: null,
  };
}

function quotaResetAt(error: unknown) {
  const record = asRecord(error);
  const candidates = [
    record?.quotaResetAt,
    record?.quota_reset_at,
    record?.resetAt,
    record?.reset_at,
    asRecord(record?.error)?.quotaResetAt,
    asRecord(record?.error)?.quota_reset_at,
    asRecord(record?.error)?.resetAt,
    asRecord(record?.error)?.reset_at,
    asRecord(record?.data)?.quotaResetAt,
    asRecord(record?.data)?.quota_reset_at,
    asRecord(record?.data)?.resetAt,
    asRecord(record?.data)?.reset_at,
  ];
  for (const candidate of candidates) {
    const parsed = parseResetTimestamp(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseResetTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 100_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
