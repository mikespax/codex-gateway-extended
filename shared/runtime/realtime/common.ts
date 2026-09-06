import { z } from "zod";

export const positiveId = z.number().int().positive();
export const nonNegativeId = z.number().int().nonnegative();
export const nonEmptyString = z.string().min(1);
export const requestIdField = { requestId: nonEmptyString };
export const threadScopeFields = { hostId: positiveId, threadId: nonEmptyString };
export const nullableString = z.string().nullable().optional();
