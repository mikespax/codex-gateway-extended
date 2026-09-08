import type { HostWithSecret } from "../infra/ssh/ssh-types";
import { codexRemotePayload, remoteLoginShellCommand } from "../infra/ssh/remote-command";
import { shellQuote } from "../infra/ssh/shell";
import { sshConnections } from "../infra/host-services";
import { KeyedTaskLimiter } from "../infra/concurrency/keyed-task-limiter";
import type { SidebarAiSummary, SidebarSummarySource } from "~~/shared/types";
import { sidebarSummarySourceFingerprint } from "~~/shared/types";

const CACHE_TTL_MS = 60_000;
const RUN_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 48 * 1024;
// Keep summaries on the efficient model that is present in the Codex CLI model catalog. The
// previously used gpt-5.4-nano slug is not advertised by current CLI releases and causes every
// batch to fail before returning JSON.
const DEFAULT_MODEL = "gpt-5.6-luna";
const MAX_PROMPT_VALUE_LENGTH = 600;
const MAX_DISPLAY_VALUE_LENGTH = 120;

interface CacheEntry {
  fingerprint: string;
  summary: SidebarAiSummary;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SidebarAiSummary[]>>();
const runnerLimiter = new KeyedTaskLimiter(1);

/**
 * Generate summaries through a trusted Codex host's existing ChatGPT login. This service is
 * intentionally best-effort: sidebar rendering never depends on OAuth, SSH, or model access.
 */
export async function summarizeSidebarBatch(
  userId: number,
  runnerHost: HostWithSecret,
  sources: SidebarSummarySource[],
) {
  const uniqueSources = uniqueSourcesForBatch(sources);
  const now = Date.now();
  const ready: SidebarAiSummary[] = [];
  const pending: Array<SidebarSummarySource & { fingerprint: string }> = [];

  for (const source of uniqueSources) {
    const fingerprint = sidebarSummarySourceFingerprint(source);
    const entry = cache.get(cacheKey(userId, source));
    if (entry !== undefined && entry.expiresAt > now && entry.fingerprint === fingerprint) {
      ready.push(entry.summary);
    } else {
      pending.push({ ...source, fingerprint });
    }
  }
  if (pending.length === 0) return ready;

  const batchKey = [
    userId,
    runnerHost.id,
    ...pending.map((source) => source.hostId + ":" + source.threadId + ":" + source.fingerprint),
  ].join("|");
  let operation = inFlight.get(batchKey);
  if (operation === undefined) {
    operation = runnerLimiter
      .run("codex-oauth-sidebar-summarizer", () => runRemoteBatch(runnerHost, pending))
      .then((summaries) => {
        const expiresAt = Date.now() + CACHE_TTL_MS;
        pruneExpiredCache(expiresAt);
        for (const summary of summaries) {
          cache.set(cacheKey(userId, summary), {
            fingerprint: summary.sourceFingerprint,
            summary,
            expiresAt,
          });
        }
        return summaries;
      })
      .finally(() => {
        inFlight.delete(batchKey);
      });
    inFlight.set(batchKey, operation);
  }

  const generated = await operation;
  return [...ready, ...generated];
}

function uniqueSourcesForBatch(sources: SidebarSummarySource[]) {
  const seen = new Set<string>();
  const result: SidebarSummarySource[] = [];
  for (const source of sources.slice(0, 20)) {
    const key = source.hostId + ":" + source.threadId;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      hostId: source.hostId,
      threadId: source.threadId,
      goal: normalizedSourceValue(source.goal),
      turnSummary: normalizedSourceValue(source.turnSummary),
      currentTask: normalizedSourceValue(source.currentTask),
      lastUserInput: normalizedSourceValue(source.lastUserInput),
    });
  }
  return result;
}

async function runRemoteBatch(
  runnerHost: HostWithSecret,
  sources: Array<SidebarSummarySource & { fingerprint: string }>,
) {
  const configuredModel = process.env.CODEX_GATEWAY_SUMMARY_MODEL?.trim();
  const model =
    configuredModel === undefined || configuredModel === "" ? DEFAULT_MODEL : configuredModel;
  const prompt = buildPrompt(sources);
  const payload = codexRemotePayload(
    "set -eu\n" +
      "prompt=" +
      shellQuote(prompt) +
      "\n" +
      'printf \'%s\' "$prompt" | "$CODEX_BIN" exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --skip-git-repo-check --color never --model ' +
      shellQuote(model) +
      " -c model_reasoning_effort=low -\n",
  );
  const result = await sshConnections.exec(runnerHost, remoteLoginShellCommand(payload), {
    timeoutMs: RUN_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });
  if (result.code !== 0) {
    throw new Error("Codex sidebar summarizer exited with code " + (result.code ?? "unknown"));
  }
  return parseRemoteSummaries(result.stdout, sources, model);
}

function buildPrompt(sources: Array<SidebarSummarySource & { fingerprint: string }>) {
  const items = sources.map((source) => ({
    key: source.hostId + ":" + source.threadId,
    sourceFingerprint: source.fingerprint,
    goal: redactForPrompt(source.goal),
    turnSummary: redactForPrompt(source.turnSummary),
    currentTask: redactForPrompt(source.currentTask),
    lastUserInput: redactForPrompt(source.lastUserInput),
  }));
  return [
    "You are a private UI metadata summarizer.",
    "Do not use shell, filesystem, network, browser, MCP, or any other tools.",
    "Return JSON only: an array of objects with key, sourceFingerprint, goal, turnSummary, currentTask, and lastUserInput.",
    "Summarize each non-empty goal, turnSummary, and lastUserInput in one concise sentence, not a fixed word count, and keep each under 120 characters.",
    "If lastUserInput is non-empty, always return a useful summary for it. Use a brief phrase only for currentTask.",
    "If goal is empty, infer the likely thread goal from the other fields when useful; return null only when there is not enough context.",
    "Keep null for an empty field. Do not include credentials, tokens, customer data, markdown, or commentary.",
    JSON.stringify({ items }),
  ].join("\n");
}

function parseRemoteSummaries(
  output: string,
  sources: Array<SidebarSummarySource & { fingerprint: string }>,
  model: string,
) {
  const parsed = parseJsonPayload(output);
  const records = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.summaries)
      ? parsed.summaries
      : [];
  const sourceByKey = new Map(
    sources.map((source) => [source.hostId + ":" + source.threadId, source]),
  );
  const generatedAt = Date.now();
  const summaries: SidebarAiSummary[] = [];
  for (const record of records) {
    if (!isRecord(record) || typeof record.key !== "string") continue;
    const source = sourceByKey.get(record.key);
    if (source === undefined) continue;
    summaries.push({
      hostId: source.hostId,
      threadId: source.threadId,
      goal: cleanGeneratedValue(record.goal),
      turnSummary: cleanGeneratedValue(record.turnSummary),
      currentTask: cleanGeneratedValue(record.currentTask),
      lastUserInput: cleanGeneratedValue(record.lastUserInput),
      sourceFingerprint: source.fingerprint,
      generatedAt,
      model,
    });
  }
  return summaries;
}

function parseJsonPayload(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function cleanGeneratedValue(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized === "" || normalized === "—" || normalized.toLowerCase() === "null") return null;
  return normalized.replace(/```/g, "").slice(0, MAX_DISPLAY_VALUE_LENGTH).trimEnd();
}

function normalizedSourceValue(value: string | null) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized === "" ? null : normalized;
}

function redactForPrompt(value: string | null) {
  if (value === null) return null;
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[redacted]")
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[-A-Za-z0-9._~+]+=*/gi, "Bearer [redacted]")
    .replace(/(password|passwd|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, MAX_PROMPT_VALUE_LENGTH);
}

function cacheKey(userId: number, source: Pick<SidebarSummarySource, "hostId" | "threadId">) {
  return userId + ":" + source.hostId + ":" + source.threadId;
}

function pruneExpiredCache(now: number) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // This map is only a latency optimization; keep memory bounded during long-lived processes.
  while (cache.size > 500) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
