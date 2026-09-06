import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { nodeErrorCode } from "./node-errors";

export interface BarkRequest {
  deviceKey: string;
  title: string;
  body: string;
  group: string | null;
  id: string | null;
  createdAt: string;
}

const barkRequestSchema = z.object({
  deviceKey: z.string(),
  title: z.string(),
  body: z.string(),
  group: z.string().nullable(),
  id: z.string().nullable(),
  createdAt: z.string(),
});

export async function useBarkReceiver() {
  const url = process.env.E2E_BARK_SERVER_URL;
  const logPath = process.env.E2E_BARK_REQUEST_LOG;
  if (url === undefined || url === "" || logPath === undefined || logPath === "") {
    throw new Error("E2E Bark receiver is not configured");
  }
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "");
  return {
    url,
    readRequests: () => readBarkRequests(logPath),
  };
}

export async function configureBarkNotifications(page: Page, serverUrl: string) {
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("tab", { name: /Notifications|通知/ }).click();
  const barkSwitch = page.getByRole("switch", { name: /Enable Bark|启用 Bark/ });
  if ((await barkSwitch.getAttribute("aria-checked")) !== "true") await barkSwitch.click();
  await page.getByLabel(/Bark server URL|Bark 服务地址/).fill(serverUrl);
  await page.getByLabel(/Bark device key|Bark 设备 Key/).fill("e2e-device-key");
  await page.getByLabel(/Bark group|Bark 分组/).fill("E2E Group");
  await page.getByRole("button", { name: /Save notification settings|保存通知设置/ }).click();
  await expect(page.getByText(/Notification settings saved|通知设置已保存/)).toBeVisible();
}

async function readBarkRequests(logPath: string) {
  const text = await readFile(logPath, "utf8").catch((error: unknown) => {
    if (nodeErrorCode(error) === "ENOENT") {
      return "";
    }
    throw error;
  });
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => barkRequestSchema.parse(JSON.parse(line)));
}
