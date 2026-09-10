import { expect, test } from "@playwright/test";
import { authenticatedFetch, openApp } from "./helpers/app";
import { z } from "zod";

const responseSchema = z.object({
  closeCount: z.number(),
  elapsedMs: z.number(),
  errorMessage: z.string(),
});

const notificationScopeSchema = z.object({
  concurrentCalls: z.number(),
  concurrentResults: z.array(z.boolean()),
  failedCalls: z.number(),
  failedResults: z.array(z.boolean()),
  retryResult: z.boolean(),
});

test("invalid app-server envelopes close the RPC generation and reject pending requests", async ({
  page,
}) => {
  await openApp(page);
  const body = await authenticatedFetch(
    page,
    { url: "/api/e2e/rpc-protocol", method: "POST" },
    (value) => responseSchema.parse(value),
  );
  expect(body).toMatchObject({ closeCount: 1 });
  expect(body).toEqual(
    expect.objectContaining({
      elapsedMs: expect.any(Number),
      errorMessage: expect.stringMatching(/invalid|expected|union/i),
    }),
  );
  expect(body.elapsedMs).toBeLessThan(1_000);
});

test("resolved plan questions do not publish a stale notification after scope inspection", async ({
  page,
}) => {
  await openApp(page);
  const body = await authenticatedFetch(
    page,
    { url: "/api/e2e/pending-request-notification", method: "POST" },
    (value) => z.object({ publishedKeys: z.array(z.string()) }).parse(value),
  );
  expect(body).toEqual({ publishedKeys: [] });
});

test("notification scope reads are coalesced and failed scopes back off", async ({ page }) => {
  await openApp(page);
  const body = await authenticatedFetch(
    page,
    { url: "/api/e2e/notification-scope-coalescing", method: "POST" },
    (value) => notificationScopeSchema.parse(value),
  );
  expect(body).toEqual({
    concurrentCalls: 1,
    concurrentResults: [true, true],
    failedCalls: 1,
    failedResults: [false, false],
    retryResult: false,
  });
});
