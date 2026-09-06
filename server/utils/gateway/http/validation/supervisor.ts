import { z } from "zod";

export const supervisorThreadReadSchema = z.object({
  cursor: z.string().trim().nullable().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const supervisorThreadEventsSchema = z.object({
  afterId: z.coerce.number().int().min(0).default(0),
  afterEpoch: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const supervisorThreadMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(8_000),
    clientMessageId: z.uuid(),
  })
  .strict();
