import { expect, test } from "./fixtures/remote-workspace";
import { openApp } from "./helpers/app";
import {
  activeRealtimeSocketCount,
  installRealtimeSocketProbe,
} from "./helpers/realtime-socket-probe";

test("streams real Linux Host metrics through the shared realtime connection", async ({
  page,
  remoteWorkspace,
}) => {
  await installRealtimeSocketProbe(page);
  await openApp(page);
  const hostName = `metrics-host-${Date.now()}`;
  const { project } = await remoteWorkspace.provision({
    hostName,
    projectName: "Metrics project",
  });

  await expect(page.getByTestId(`project-button-${project.id}`)).toBeVisible();
  await page.getByTestId("open-host-monitor-button").click();
  const panel = page.getByTestId("host-metrics-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("host-metric-cpu")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("host-metric-memory")).toBeVisible();
  await expect(panel.getByTestId("host-metric-network")).toBeVisible();
  await expect(panel.getByTestId("host-metric-disk")).toBeVisible();
  await expect(panel.getByText("实时采集中")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "GPU", exact: true })).toBeVisible();
  await expect(panel.getByTestId("host-metric-gpu-0")).toContainText("E2E Training GPU");
  const gpuProcesses = panel.getByTestId("host-gpu-processes");
  await expect(gpuProcesses).toBeVisible();
  await expect(gpuProcesses.getByText("trainer", { exact: true }).first()).toBeVisible();
  await expect(gpuProcesses.getByText("/usr/local/bin/e2e-gpu-training").first()).toBeVisible();
  await expect(gpuProcesses.getByText("6.0 GiB").first()).toBeVisible();
  await expect.poll(() => activeRealtimeSocketCount(page)).toBe(1);

  const monitorTab = page.getByRole("tab", { name: "主机监控" });
  await monitorTab.getByLabel(/关闭标签页|Close tab/).click();
  await expect(panel).toBeHidden();
  await page.getByTestId("open-host-monitor-button").click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: hostName })).toBeVisible();
  await expect(panel.getByTestId("host-metric-cpu")).toBeVisible();
});
