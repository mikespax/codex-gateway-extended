import type { GatewayThread } from "~~/shared/types";
import { trimmedOrNull } from "~~/shared/utils/strings";

interface SubAgentDisplayNameInput {
  thread?: Pick<GatewayThread, "agentNickname" | "agentRole"> | null;
  agentPath?: unknown;
  titleCandidate?: unknown;
  threadId?: string | null;
  fallback: string;
}

export function subAgentDisplayName(input: SubAgentDisplayNameInput) {
  const nickname = humanText(input.thread?.agentNickname, input.threadId);
  const role = humanText(input.thread?.agentRole, input.threadId);
  if (nickname !== null) return role !== null ? `${nickname} [${role}]` : nickname;

  const pathName = agentPathName(input.agentPath, input.threadId);
  if (pathName !== null) return pathName;

  return humanText(input.titleCandidate, input.threadId) ?? input.fallback;
}

export function subAgentTitleCandidate(value: unknown, threadId?: string | null) {
  return agentPathName(value, threadId) ?? humanText(value, threadId);
}

function agentPathName(value: unknown, threadId?: string | null) {
  const path = text(value);
  if (path === null) return null;
  const name = path
    .split("/")
    .filter((part) => part !== "")
    .at(-1);
  return humanText(name, threadId);
}

function humanText(value: unknown, threadId?: string | null) {
  const candidate = text(value);
  if (candidate === null || candidate === threadId || isMachineIdentifier(candidate)) return null;
  return candidate;
}

function text(value: unknown) {
  return typeof value === "string" ? trimmedOrNull(value) : null;
}

function isMachineIdentifier(value: string) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^agent-[0-9a-f]{8}(?:-[0-9a-f-]+)?$/i.test(value)
  );
}
