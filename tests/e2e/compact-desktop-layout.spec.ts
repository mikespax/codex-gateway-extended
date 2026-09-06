import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import {
  deferredRealtimeTurnStartRequests,
  installDeferredRealtimeTurnStartRoute,
} from "./helpers/realtime-route";
import { seedGatewayThread } from "./helpers/gateway-store";

test("uses the mobile chat drawer in a narrow desktop browser", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openApp(page);

  await expect(page.getByTestId("mobile-layout")).toBeVisible();
  await expect(page.getByTestId("desktop-layout")).toBeHidden();

  await page.getByTestId("mobile-sidebar-toggle").click();
  await expect(page.getByTestId("settings-toggle")).toBeVisible();
});

test("keeps Enter-to-send in a narrow desktop browser", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await openApp(page);
  await expect(page.getByTestId("mobile-layout")).toBeVisible();

  const threadId = "compact-desktop-enter-send";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Compact Desktop Enter Send" },
  });

  const composer = page.getByTestId("composer-input");
  await composer.focus();
  await composer.fill("Send from a narrow desktop window");
  installDeferredRealtimeTurnStartRoute(page, { id: "compact-desktop-enter-turn" });
  await composer.press("Enter");

  await expect.poll(() => deferredRealtimeTurnStartRequests(page)).toHaveLength(1);
  expect(deferredRealtimeTurnStartRequests(page)[0]?.text).toBe(
    "Send from a narrow desktop window",
  );
});
