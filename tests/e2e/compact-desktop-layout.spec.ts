import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";

test("uses the mobile chat drawer in a narrow desktop browser", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openApp(page);

  await expect(page.getByTestId("mobile-layout")).toBeVisible();
  await expect(page.getByTestId("desktop-layout")).toBeHidden();

  await page.getByTestId("mobile-sidebar-toggle").click();
  await expect(page.getByTestId("settings-toggle")).toBeVisible();
});
