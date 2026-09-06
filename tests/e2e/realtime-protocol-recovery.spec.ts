import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import {
  activeRealtimeSocketCount,
  dispatchRealtimeServerFrame,
  installRealtimeSocketProbe,
  realtimeSocketCloseCalls,
} from "./helpers/realtime-socket-probe";

test("closes the protocol stream instead of ignoring a malformed server frame", async ({
  page,
}) => {
  await installRealtimeSocketProbe(page);
  // This case verifies the browser's close/reconnect handshake, so it must not use Playwright's
  // transparent WebSocketRoute: that route intentionally owns and virtualizes close propagation.
  await openApp(page, { interceptRealtime: false });
  await expect.poll(() => activeRealtimeSocketCount(page)).toBe(1);

  const closeCallCount = (await realtimeSocketCloseCalls(page)).length;
  await dispatchRealtimeServerFrame(page, "{not-json");

  // Strict parsing deliberately closes the compromised protocol stream. Assert the protocol close
  // directly instead of coupling parser coverage to the remote peer's close-handshake timing.
  await expect
    .poll(async () => (await realtimeSocketCloseCalls(page)).slice(closeCallCount))
    .toContainEqual({ code: 1002, reason: "Invalid realtime server frame" });
  await expect(page.getByTestId("app-ready")).toBeAttached();
});
