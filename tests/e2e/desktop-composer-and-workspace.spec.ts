import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import {
  deferredRealtimeTurnStartRequests,
  installDeferredRealtimeTurnStartRoute,
} from "./helpers/realtime-route";
import { seedGatewayThread } from "./helpers/gateway-store";

test("focuses the desktop composer, sends with Enter, and keeps Shift+Enter multiline", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "desktop-enter-send";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Desktop Enter Send" },
  });

  const composer = page.getByTestId("composer-input");
  await expect(composer).toBeFocused();
  await composer.fill("First desktop line");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Second desktop line");
  await expect(composer).toHaveAttribute("data-value", "First desktop line\nSecond desktop line");

  installDeferredRealtimeTurnStartRoute(page, { id: "desktop-enter-turn" });
  await composer.press("Enter");
  await expect.poll(() => deferredRealtimeTurnStartRequests(page)).toHaveLength(1);
  expect(deferredRealtimeTurnStartRequests(page)[0]?.text).toBe(
    "First desktop line\nSecond desktop line",
  );
});

test("keeps Files hidden until a file is explicitly opened and shows usage on desktop", async ({
  page,
}) => {
  await page.route("**/api/hosts/1/codex-usage", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        hostId: 1,
        limitId: "codex",
        limitName: "Codex",
        planType: "pro",
        primary: { usedPercent: 31, remainingPercent: 69, windowDurationMins: 300, resetsAt: null },
        secondary: null,
        observedAt: Date.now(),
      }),
    });
  });
  await openApp(page);
  await seedGatewayThread(page, {
    projectId: 1,
    threadId: "desktop-workspace-header",
    currentThread: { id: "desktop-workspace-header", name: "Desktop Workspace Header" },
  });

  await expect(page.getByTestId("codex-usage-badge")).toHaveText("69%");
  await expect(
    page.locator('[data-testid="workspace-dock-tab"][data-panel-kind="agent"]'),
  ).toHaveAttribute("data-panel-title", "Desktop Workspace Header");
  await expect(
    page.locator('[data-testid="workspace-dock-tab"][data-panel-kind="files"]'),
  ).toHaveCount(0);
});
