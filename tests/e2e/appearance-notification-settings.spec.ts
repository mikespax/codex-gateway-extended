import { expect, test } from "@playwright/test";
import { openApp, reloadApp } from "./helpers/app";

test("applies and persists the selected account-local interface colorway", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "外观" }).click();

  await page
    .getByTestId("appearance-colorway-select")
    .locator('[data-slot="select-trigger"]')
    .click();
  await page.getByRole("option", { name: "Ocean 蓝色" }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.colorway))
    .toBe("blue");

  const storedColorway = await page.evaluate(() => {
    const username = localStorage.getItem("codex-gateway-auth-token:username") ?? "";
    return localStorage.getItem(`codex-gateway:${encodeURIComponent(username)}:colorway`);
  });
  expect(storedColorway).toBe("blue");

  await reloadApp(page);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.colorway))
    .toBe("blue");
});

test("persists desktop completion sound choice and bounded volume", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "通知" }).click();

  await page.getByTestId("completion-sound-select").locator('[data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: "明亮铃声" }).click();
  const volume = page.getByTestId("completion-sound-volume").getByRole("slider");
  await volume.focus();
  await page.keyboard.press("End");
  await expect(volume).toHaveAttribute("aria-valuenow", "100");

  const storedSoundSettings = await page.evaluate(() => {
    const username = localStorage.getItem("codex-gateway-auth-token:username") ?? "";
    const prefix = `codex-gateway:${encodeURIComponent(username)}:desktop-completion-sound`;
    return {
      sound: localStorage.getItem(`${prefix}-type`),
      volume: localStorage.getItem(`${prefix}-volume`),
    };
  });
  expect(storedSoundSettings).toEqual({ sound: "bell", volume: "100" });

  await reloadApp(page);
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: "通知" }).click();
  await expect(
    page.getByTestId("completion-sound-select").locator('[data-slot="select-trigger"]'),
  ).toContainText("明亮铃声");
  await expect(page.getByTestId("completion-sound-volume").getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
});
