import type { Page } from "@playwright/test";
import type { RealtimeClientMessage, RealtimeServerMessage } from "../../../shared/types";
import { parseRealtimeServerMessage } from "../../../shared/runtime/realtime";

export async function sendRealtimeRequest(
  page: Page,
  message: Extract<RealtimeClientMessage, { requestId: string }>,
) {
  const response = await sendRealtimeRawRequest(page, message);
  if (response.type === "error") {
    throw new Error(response.message === "" ? "Realtime request failed" : response.message);
  }
  return response;
}

export async function sendRealtimeRawRequest(
  page: Page,
  message: Extract<RealtimeClientMessage, { requestId: string }>,
): Promise<RealtimeServerMessage> {
  const response = await page.evaluate(async (message) => {
    const realtime = window.__codexGatewayE2e?.realtime;
    if (!realtime) throw new Error("Gateway E2E driver is unavailable");
    try {
      return await realtime.request((requestId) => ({ ...message, requestId }));
    } catch (error: unknown) {
      const details =
        error !== null &&
        typeof error === "object" &&
        "details" in error &&
        error.details !== null &&
        typeof error.details === "object"
          ? error.details
          : {};
      return {
        type: "error",
        requestId: message.requestId,
        request: message,
        message: error instanceof Error ? error.message : "Realtime request failed",
        code: "code" in details && typeof details.code === "string" ? details.code : undefined,
        details,
      };
    }
  }, message);
  return parseRealtimeServerMessage(response);
}
