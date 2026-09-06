import { expect, test } from "./fixtures/remote-workspace";
import { openApp, reloadApp } from "./helpers/app";
import { selectSidebarThread, startRemotePreviewServer } from "./helpers/remote-codex";

test("opens a real remote HTTP and WebSocket service through the SSH preview proxy", async ({
  page,
  remoteWorkspace,
}) => {
  const { remote } = remoteWorkspace;
  await openApp(page);
  const host = await remoteWorkspace.addHost(`preview-host-${Date.now()}`);
  const project = await remoteWorkspace.addProject(host.id, `preview-project-${Date.now()}`);
  const previewThreadId = await remoteWorkspace.startThread(project.id);
  const otherThreadId = await remoteWorkspace.startThread(project.id);
  await selectSidebarThread(page, previewThreadId);
  await startRemotePreviewServer(remote);

  await page.getByTestId("open-browser-button").click();
  await page.getByPlaceholder("http://localhost:3000").fill("http://localhost:4173");
  await page.getByTestId("browser-open-submit").click();
  await expect(page.getByRole("tab", { name: "localhost:4173" })).toBeVisible({ timeout: 5_000 });

  const preview = page.frameLocator('iframe[title="localhost:4173"]');
  await expect(preview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(preview.locator("#asset")).toHaveText("remote-preview-static-asset-ok");
  await expect(preview.locator("#http")).toHaveText("remote-preview-http-ok");
  await expect(preview.locator("#ws")).toHaveText("remote-preview-websocket");
  await expect(page.getByText("404 GET /missing-preview-entry.js")).toBeVisible();

  // Switching thread scopes destroys the keyed Dockview tree. Returning recreates the iframe
  // with its original bootstrap URL, matching normal desktop/mobile workspace navigation.
  await selectSidebarThread(page, otherThreadId);
  await selectSidebarThread(page, previewThreadId);
  await page.getByRole("tab", { name: "localhost:4173" }).click();
  await expect(preview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(preview.locator("#asset")).toHaveText("remote-preview-static-asset-ok");

  await reloadApp(page);
  await page.getByRole("tab", { name: "localhost:4173" }).click();
  await expect(preview.getByRole("heading", { name: "remote-preview-page" })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByRole("tab", { name: "localhost:4173" })
    .getByLabel(/关闭标签页|Close tab/)
    .click();
  await expect(page.getByRole("tab", { name: "localhost:4173" })).toBeHidden();
});
