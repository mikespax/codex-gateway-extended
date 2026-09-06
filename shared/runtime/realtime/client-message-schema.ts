import { z } from "zod";
import type { RealtimeClientMessage } from "../../types";
import {
  nonEmptyString,
  nonNegativeId,
  nullableString,
  positiveId,
  requestIdField,
  threadScopeFields,
} from "./common";

const approvalPolicy = z.enum(["untrusted", "on-request", "never"]).nullable().optional();
const imageInput = z
  .object({
    path: z.string().optional(),
    url: z.string().optional(),
    detail: z.enum(["low", "high", "auto", "original"]).optional(),
  })
  .strict();
const strictFileInput = z
  .object({
    path: z.string(),
    name: z.string(),
    mimeType: nullableString,
    size: z.number().nonnegative(),
    isImage: z.boolean(),
  })
  .strict();
const fileInput = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

  // Compatibility for browser tabs opened before composer attachment payloads were projected to
  // wire-only fields. Keep the trust boundary strict for every other unknown property.
  const wireValue: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(value)) {
    if (key !== "id") wireValue[key] = property;
  }
  return wireValue;
}, strictFileInput);
const collaborationMode = z
  .object({
    mode: z.enum(["default", "plan"]),
    settings: z
      .object({
        model: z.string(),
        reasoningEffort: nullableString,
        developerInstructions: nullableString,
      })
      .strict(),
  })
  .strict()
  .nullable()
  .optional();

// Every browser-controlled field is validated at the WebSocket trust boundary. Do not replace
// this union with a type-only assertion: malformed terminal/browser/attachment fields would then
// enter handlers as trusted values and fail far from the peer that supplied them.
export const realtimeClientMessageSchema: z.ZodType<RealtimeClientMessage> = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("auth.authenticate"), token: nonEmptyString }).strict(),
    z.object({ type: z.literal("host.lifecycle.subscribe") }).strict(),
    z.object({ type: z.literal("host.lifecycle.unsubscribe") }).strict(),
    z
      .object({ type: z.literal("host.metrics.subscribe"), ...requestIdField, hostId: positiveId })
      .strict(),
    z.object({ type: z.literal("host.metrics.unsubscribe"), hostId: positiveId }).strict(),
    z
      .object({ type: z.literal("tmux.sessions.subscribe"), ...requestIdField, hostId: positiveId })
      .strict(),
    z
      .object({ type: z.literal("tmux.sessions.refresh"), ...requestIdField, hostId: positiveId })
      .strict(),
    z.object({ type: z.literal("tmux.sessions.unsubscribe"), hostId: positiveId }).strict(),
    z
      .object({
        type: z.literal("thread.activate"),
        ...requestIdField,
        ...threadScopeFields,
        projectId: positiveId.nullable().optional(),
        cwd: nullableString,
        limit: positiveId.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("thread.subscribe"),
        ...threadScopeFields,
        afterId: nonNegativeId.optional(),
        afterEpoch: nonEmptyString.optional(),
      })
      .strict(),
    z.object({ type: z.literal("thread.unsubscribe"), ...threadScopeFields }).strict(),
    z
      .object({
        type: z.literal("thread.turns.load"),
        ...requestIdField,
        ...threadScopeFields,
        cursor: nullableString,
        limit: positiveId.optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("thread.start"),
        ...requestIdField,
        hostId: positiveId,
        projectId: positiveId.nullable().optional(),
        cwd: nullableString,
        model: nullableString,
        effort: nullableString,
        serviceTier: nullableString,
        approvalPolicy,
      })
      .strict(),
    z
      .object({
        type: z.literal("turn.start"),
        ...requestIdField,
        ...threadScopeFields,
        projectId: positiveId,
        text: z.string(),
        clientUserMessageId: nullableString,
        cwd: nullableString,
        model: nullableString,
        effort: nullableString,
        serviceTier: nullableString,
        approvalPolicy,
        collaborationMode,
        images: z.array(imageInput).optional(),
        files: z.array(fileInput).optional(),
        references: z
          .array(
            z
              .object({
                type: z.literal("file"),
                path: nonEmptyString,
                name: nonEmptyString,
              })
              .strict(),
          )
          .max(10)
          .optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("turn.steer"),
        ...requestIdField,
        ...threadScopeFields,
        projectId: positiveId,
        expectedTurnId: nonEmptyString,
        text: z.string(),
        clientUserMessageId: nullableString,
        cwd: nullableString,
        images: z.array(imageInput).optional(),
        references: z
          .array(
            z
              .object({
                type: z.literal("file"),
                path: nonEmptyString,
                name: nonEmptyString,
              })
              .strict(),
          )
          .max(10)
          .optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("turn.interrupt"),
        ...requestIdField,
        ...threadScopeFields,
        turnId: nonEmptyString,
      })
      .strict(),
    z
      .object({
        type: z.literal("thread.goal.set"),
        ...requestIdField,
        ...threadScopeFields,
        objective: nullableString,
        status: z
          .enum(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"])
          .nullable()
          .optional(),
        tokenBudget: z.number().int().positive().nullable().optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("thread.goal.clear"), ...requestIdField, ...threadScopeFields })
      .strict(),
    z
      .object({ type: z.literal("thread.goal.get"), ...requestIdField, ...threadScopeFields })
      .strict(),
    z
      .object({
        type: z.literal("serverRequest.respond"),
        ...requestIdField,
        ...threadScopeFields,
        serverRequestId: z.union([z.string(), z.number()]),
        result: z.unknown().optional(),
        error: z
          .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
          .strict()
          .optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("terminal.open"),
        ...requestIdField,
        hostId: positiveId,
        projectId: positiveId.nullable().optional(),
        threadId: nullableString,
        cwd: nullableString,
        title: nullableString,
        scope: z.enum(["host", "project", "thread"]),
        cols: positiveId,
        rows: positiveId,
      })
      .strict(),
    z.object({ type: z.literal("terminal.list"), ...requestIdField }).strict(),
    z
      .object({ type: z.literal("terminal.input"), sessionId: nonEmptyString, data: z.string() })
      .strict(),
    z
      .object({
        type: z.literal("terminal.resize"),
        sessionId: nonEmptyString,
        cols: positiveId,
        rows: positiveId,
      })
      .strict(),
    z
      .object({ type: z.literal("terminal.close"), ...requestIdField, sessionId: nonEmptyString })
      .strict(),
    z
      .object({
        type: z.literal("browser.open"),
        ...requestIdField,
        hostId: positiveId,
        projectId: positiveId.nullable().optional(),
        threadId: nullableString,
        panelId: nonEmptyString,
        targetUrl: nonEmptyString,
        allowInsecureTls: z.boolean().optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("browser.close"), ...requestIdField, sessionId: nonEmptyString })
      .strict(),
    z
      .object({
        type: z.literal("browser.allowInsecureTls"),
        ...requestIdField,
        sessionId: nonEmptyString,
        allowInsecureTls: z.boolean(),
      })
      .strict(),
    z
      .object({
        type: z.literal("file.git.compare"),
        ...requestIdField,
        hostId: positiveId,
        projectId: positiveId,
        path: nonEmptyString,
      })
      .strict(),
    z
      .object({
        type: z.literal("file.git.workspace.inspect"),
        ...requestIdField,
        hostId: positiveId,
        projectId: positiveId,
        rootPath: nonEmptyString,
      })
      .strict(),
    z.object({ type: z.literal("ping"), nonce: z.string().optional() }).strict(),
  ],
);
