import { z } from "zod";

export const hookRunSchema = z
  .object({
    eventName: z.unknown().optional(),
    status: z.unknown().optional(),
    statusMessage: z.unknown().optional(),
    entries: z.array(z.unknown()).optional(),
  })
  .loose();

export const guardianReviewSchema = z
  .object({
    status: z.unknown().optional(),
    riskLevel: z.unknown().optional(),
    rationale: z.unknown().optional(),
    userAuthorization: z.unknown().optional(),
  })
  .loose();

export const rateLimitsSchema = z
  .object({
    planType: z.unknown().optional(),
    limitName: z.unknown().optional(),
    limitId: z.unknown().optional(),
    rateLimitReachedType: z.unknown().optional(),
  })
  .loose();

export const externalImportResultSchema = z
  .object({
    successes: z.array(z.unknown()).optional(),
    failures: z.array(z.unknown()).optional(),
  })
  .loose();
export const externalImportResultsSchema = z.array(externalImportResultSchema);

export const categoryRecordSchema = z.record(z.string(), z.unknown());
