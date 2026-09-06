import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import { installRealtimeThreadSnapshotMock, seedGatewayThread } from "./helpers/gateway-store";
import { defaultGatewayHost, defaultGatewayProject } from "./fixtures/thread-history";

test("collapses the desktop sidebar and restores the saved layout", async ({ page }) => {
  await openApp(page);

  const sidebarGap = page.locator('[data-slot="sidebar-gap"]');
  await expect(page.locator('[data-slot="sidebar"][data-state="expanded"]')).toBeVisible();
  await page.getByTestId("desktop-sidebar-collapse").click();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBe(0);
  await expect(page.getByTestId("desktop-sidebar-expand")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("desktop-sidebar-expand")).toBeVisible();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBe(0);

  await page.getByTestId("desktop-sidebar-expand").click();
  await expect.poll(() => sidebarGap.evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("desktop-sidebar-collapse")).toBeVisible();
});

test("uses the selected host's most recently used project for a new thread", async ({ page }) => {
  await openApp(page);
  const host = {
    ...defaultGatewayHost(111),
    name: "Target Host",
    sshHost: "target.example.internal",
  };
  const currentHost = {
    ...defaultGatewayHost(112),
    name: "Current Host",
    sshHost: "current.example.internal",
  };
  const firstProject = {
    ...defaultGatewayProject(host.id, 211),
    name: "Older Project",
    remotePath: "/workspace/older",
  };
  const recentProject = {
    ...defaultGatewayProject(host.id, 212),
    name: "Recent Project",
    remotePath: "/workspace/recent",
  };
  const currentProject = {
    ...defaultGatewayProject(currentHost.id, 213),
    name: "Current Project",
    remotePath: "/workspace/current",
  };

  await page.evaluate(
    ({ host, currentHost, firstProject, recentProject, currentProject }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const { activity, catalog, navigation, views } = driver;
      catalog.hosts = [currentHost, host];
      catalog.projects = [firstProject, recentProject, currentProject];
      navigation.selectedHostId = currentHost.id;
      navigation.selectedProjectId = currentProject.id;
      navigation.selectedThreadId = null;
      activity.ingestMetadata(
        host.id,
        [
          {
            id: "older-thread",
            title: "Older thread",
            projectId: firstProject.id,
            cwd: firstProject.remotePath,
            parentThreadId: null,
            agentNickname: null,
            agentRole: null,
            name: null,
            preview: null,
            recencyAt: null,
            updatedAt: 10,
          },
          {
            id: "recent-thread",
            title: "Recent thread",
            projectId: recentProject.id,
            cwd: recentProject.remotePath,
            parentThreadId: null,
            agentNickname: null,
            agentRole: null,
            name: null,
            preview: null,
            recencyAt: null,
            updatedAt: 20,
          },
        ],
        catalog.projects,
      );
      views.startThread = async (_options, context) => {
        window.__codexGatewayNewThreadContext = context ?? null;
      };
    },
    { host, currentHost, firstProject, recentProject, currentProject },
  );

  await page.getByTestId("new-thread-button").click();
  await page.getByTestId(`new-thread-host-option-${host.id}`).click();
  await expect
    .poll(() => page.evaluate(() => window.__codexGatewayNewThreadContext ?? null))
    .toEqual({ hostId: host.id, projectId: recentProject.id });
});

test("toggles an expanded project closed from the desktop sidebar", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    hostId: 101,
    projectId: null,
    host: { ...defaultGatewayHost(101), name: "Toggle Host" },
    project: {
      ...defaultGatewayProject(101, 201),
      name: "Toggle Project",
      remotePath: "/workspace/toggle",
    },
    threads: [
      {
        id: "toggle-thread",
        title: "Toggle Thread",
        pinned: false,
        updatedAt: Date.now(),
      },
    ],
  });
  await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    driver.catalog.selectProject = async (projectId: number) => {
      const { navigation } = driver;
      navigation.selectedProjectId = projectId;
      navigation.selectedThreadId = null;
    };
  });

  await expect(page.getByTestId("desktop-layout")).toBeVisible();
  await expect(page.getByTestId("project-button-201")).toBeVisible();
  await page.getByTestId("project-button-201").click();
  await expect(page.getByTestId("thread-button-toggle-thread")).toBeVisible();

  await page.getByTestId("project-button-201").click();
  await expect(page.getByTestId("thread-button-toggle-thread")).toBeHidden();
});

test("marks completed threads as needing review until they are opened", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    hostId: 102,
    projectId: 202,
    threadId: "selected-thread",
    host: { ...defaultGatewayHost(102), name: "Review Host" },
    project: {
      ...defaultGatewayProject(102, 202),
      name: "Review Project",
      remotePath: "/workspace/review",
    },
    currentThread: { id: "selected-thread", name: "Selected Thread" },
    threads: [
      {
        id: "review-thread",
        name: "Review Thread",
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      },
      {
        id: "selected-thread",
        name: "Selected Thread",
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    ],
    status: "completed",
  });
  await installRealtimeThreadSnapshotMock(page, {
    hostId: 102,
    snapshots: {
      "review-thread": {
        thread: { id: "review-thread", name: "Review Thread" },
        history: { thread: { id: "review-thread", turns: [] } },
        projectId: 202,
        runtimeStatus: "completed",
      },
    },
  });
  await page.evaluate(() => {
    const runtime = window.__codexGatewayE2e?.runtime;
    if (!runtime) throw new Error("Gateway E2E driver is unavailable");
    runtime.setThreadStatus(102, "review-thread", "running");
    runtime.setThreadStatus(102, "review-thread", "completed");
  });

  await expect(page.getByTestId("thread-button-review-thread")).toBeVisible();
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成，待查看", { exact: true }),
  ).toBeVisible();

  await page.getByTestId("thread-button-review-thread").click();
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("thread-button-review-thread").getByLabel("已完成，待查看", { exact: true }),
  ).toBeHidden();
});

test("keeps non-pinned main threads in recent activity for the page session", async ({ page }) => {
  await openApp(page);
  const host = {
    ...defaultGatewayHost(104),
    name: "Activity Host",
    sshHost: "activity.example.internal",
  };
  const project = {
    ...defaultGatewayProject(104, 204),
    name: "Activity Project",
    remotePath: "/workspace/activity",
  };
  await page.evaluate(
    ({ host, project }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const { activity, catalog, config, runtime } = driver;
      catalog.hosts = [host];
      catalog.projects = [project];
      config.gatewayConfig.pinnedThreads = [
        {
          hostId: host.id,
          projectId: project.id,
          threadId: "already-pinned",
          title: "Already pinned",
        },
      ];
      activity.ingestMetadata(
        host.id,
        [
          {
            id: "recent-main",
            title: "Recent main thread",
            projectId: project.id,
            cwd: project.remotePath,
            parentThreadId: null,
            agentNickname: null,
            agentRole: null,
            name: null,
            preview: null,
            recencyAt: null,
            updatedAt: 3,
          },
          {
            id: "already-pinned",
            title: "Already pinned",
            projectId: project.id,
            cwd: null,
            parentThreadId: null,
            agentNickname: null,
            agentRole: null,
            name: null,
            preview: null,
            recencyAt: null,
            updatedAt: 2,
          },
          {
            id: "spawned-child",
            title: "Spawned child",
            projectId: project.id,
            parentThreadId: "recent-main",
            cwd: null,
            agentNickname: null,
            agentRole: null,
            name: null,
            preview: null,
            recencyAt: null,
            updatedAt: 1,
          },
          {
            id: "managed-child-before-parent-hydration",
            title: "Inherited parent title",
            projectId: project.id,
            agentRole: "explorer",
            agentNickname: "Scout",
            cwd: null,
            parentThreadId: null,
            name: null,
            preview: null,
            recencyAt: null,
            updatedAt: 4,
          },
        ],
        [project],
      );
      runtime.setThreadStatus(host.id, "recent-main", "running");
      runtime.setThreadStatus(host.id, "already-pinned", "running");
      runtime.setThreadStatus(host.id, "spawned-child", "running");
      runtime.setThreadStatus(host.id, "managed-child-before-parent-hydration", "running");
      runtime.setThreadStatus(host.id, "recent-main", "completed");
    },
    { host, project },
  );

  await expect(page.getByText("最近运行", { exact: true })).toBeVisible();
  await expect(page.getByTestId("recent-thread-button-recent-main")).toBeVisible();
  await expect(page.getByTestId("recent-thread-button-already-pinned")).toBeHidden();
  await expect(page.getByTestId("recent-thread-button-spawned-child")).toBeHidden();
  await expect(
    page.getByTestId("recent-thread-button-managed-child-before-parent-hydration"),
  ).toBeHidden();

  const sectionOrder = await page.getByTestId("sidebar-scroll-area").evaluate((root) => {
    const text = root.textContent ?? "";
    return [text.indexOf("已固定"), text.indexOf("最近运行"), text.indexOf("主机")];
  });
  expect(sectionOrder[0]).toBeLessThan(sectionOrder[1]!);
  expect(sectionOrder[1]).toBeLessThan(sectionOrder[2]!);
});

test("does not reorder chat activity while a turn is still running", async ({ page }) => {
  await openApp(page);
  const host = {
    ...defaultGatewayHost(105),
    name: "Stable activity host",
  };
  const project = {
    ...defaultGatewayProject(105, 205),
    name: "Stable activity project",
    remotePath: "/workspace/stable-activity",
  };
  await page.evaluate(
    ({ host, project }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const now = Math.floor(Date.now() / 1000);
      const base = [
        {
          id: "stable-chat-a",
          title: "Stable chat A",
          updatedAt: now - 100,
        },
        {
          id: "stable-chat-b",
          title: "Stable chat B",
          updatedAt: now - 200,
        },
      ];
      driver.catalog.hosts = [host];
      driver.catalog.projects = [project];
      driver.activity.ingestMetadata(
        host.id,
        base.map((thread) => ({
          ...thread,
          projectId: project.id,
          cwd: project.remotePath,
          parentThreadId: null,
          agentNickname: null,
          agentRole: null,
          name: null,
          preview: null,
          recencyAt: null,
        })),
        [project],
      );
      // Simulate the realtime summary churn emitted by tool/code activity. The newer observed
      // timestamp must not move chat B before chat A until the turn reaches a terminal status.
      driver.activity.ingestMetadata(
        host.id,
        [
          {
            id: "stable-chat-b",
            title: "Stable chat B",
            updatedAt: now + 100,
            projectId: project.id,
            cwd: project.remotePath,
            parentThreadId: null,
            agentNickname: null,
            agentRole: null,
            name: null,
            preview: null,
            recencyAt: null,
          },
        ],
        [project],
      );
    },
    { host, project },
  );

  const recentRows = page.locator('[data-testid^="recent-thread-button-"]');
  await expect(recentRows).toHaveCount(2);
  await expect
    .poll(() =>
      recentRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-testid")?.replace("recent-thread-button-", "")),
      ),
    )
    .toEqual(["stable-chat-a", "stable-chat-b"]);

  await page.evaluate(() => {
    const runtime = window.__codexGatewayE2e?.runtime;
    if (!runtime) throw new Error("Gateway E2E driver is unavailable");
    runtime.setThreadStatus(105, "stable-chat-b", "running");
    runtime.setThreadStatus(105, "stable-chat-b", "completed");
  });
  await expect
    .poll(() =>
      recentRows.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-testid")?.replace("recent-thread-button-", "")),
      ),
    )
    .toEqual(["stable-chat-b", "stable-chat-a"]);
});

test("sorts pinned threads for display without rewriting persisted pin order", async ({ page }) => {
  await openApp(page);
  const hosts = [
    { ...defaultGatewayHost(302), name: "Zulu Host" },
    { ...defaultGatewayHost(301), name: "Alpha Host" },
  ];
  const pinnedThreads = [
    { hostId: 302, projectId: null, threadId: "z-alpha", title: "Alpha Thread" },
    { hostId: 301, projectId: null, threadId: "a-zulu", title: "Zulu Thread" },
    { hostId: 301, projectId: null, threadId: "a-alpha-b", title: "Alpha Thread" },
    { hostId: 301, projectId: null, threadId: "a-alpha-a", title: "Alpha Thread" },
  ];
  await page.evaluate(
    ({ hosts, pinnedThreads }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      driver.catalog.hosts = hosts;
      driver.config.gatewayConfig.pinnedThreads = pinnedThreads;
    },
    { hosts, pinnedThreads },
  );

  const renderedThreadIds = await page
    .locator('[data-testid^="pinned-thread-button-"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-testid")?.replace("pinned-thread-button-", "")),
    );
  expect(renderedThreadIds).toEqual(["a-alpha-a", "a-alpha-b", "a-zulu", "z-alpha"]);

  const storedThreadIds = await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    return driver.config.gatewayConfig.pinnedThreads.map((thread) => thread.threadId);
  });
  expect(storedThreadIds).toEqual(pinnedThreads.map((thread) => thread.threadId));
});

test("long expanded tree labels truncate without displacing trailing statuses", async ({
  page,
}) => {
  await openApp(page);
  const hostId = 103;
  const projectId = 203;
  const threadId = "long-sidebar-thread";
  const longTitle = `Long thread ${"unbroken-segment-".repeat(18)}`;
  await seedGatewayThread(page, {
    hostId,
    projectId,
    threadId: null,
    host: {
      ...defaultGatewayHost(hostId),
      name: `Long host ${"host-segment-".repeat(12)}`,
      sshHost: "very-long-hostname.example.internal",
    },
    project: {
      ...defaultGatewayProject(hostId, projectId),
      name: `Long project ${"project-segment-".repeat(12)}`,
      remotePath: "/workspace/sidebar-layout",
    },
    threads: [{ id: threadId, name: longTitle, pinned: false, updatedAt: 1 }],
  });
  await installRealtimeThreadSnapshotMock(page, {
    hostId,
    snapshots: {
      [threadId]: {
        thread: { id: threadId, name: longTitle },
        history: { thread: { id: threadId, turns: [] } },
        projectId,
        runtimeStatus: "running",
      },
    },
  });
  await page.evaluate(
    ({ hostId, threadId }) => {
      const driver = window.__codexGatewayE2e;
      if (!driver) throw new Error("Gateway E2E driver is unavailable");
      const { catalog, runtime } = driver;
      catalog.hostConnectionStatuses = { [hostId]: { status: "connected" } };
      runtime.setThreadStatus(hostId, threadId, "running");
    },
    { hostId, threadId },
  );

  await expect(page.getByTestId(`thread-button-${threadId}`)).toBeVisible();
  await page.getByTestId(`thread-button-${threadId}`).click();
  await expect(page.getByTestId(`thread-button-${threadId}`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.getByTestId(`host-button-${hostId}`).getByLabel("已连接")).toBeVisible();
  await expect(page.getByTestId(`thread-button-${threadId}`).getByLabel("运行中")).toBeVisible();

  const metrics = await page.getByTestId("sidebar-scroll-area").evaluate(
    (root, { hostId, threadId, longTitle }) => {
      const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      const threadButton = root.querySelector<HTMLElement>(
        `[data-testid="thread-button-${CSS.escape(threadId)}"]`,
      );
      const title = threadButton?.querySelector<HTMLElement>(`[title="${CSS.escape(longTitle)}"]`);
      const hostStatus = root.querySelector<HTMLElement>(
        `[data-testid="host-button-${hostId}"] [aria-label="已连接"]`,
      );
      const threadStatus = threadButton?.querySelector<HTMLElement>('[aria-label="运行中"]');
      const statuses = [hostStatus, threadStatus];
      if (!viewport || !title || statuses.some((status) => !status)) {
        throw new Error("Missing sidebar layout nodes");
      }
      const viewportRect = viewport.getBoundingClientRect();
      return {
        overflow: viewport.scrollWidth - viewport.clientWidth,
        titleClipped: title.scrollWidth > title.clientWidth,
        titleOverflow: getComputedStyle(title).textOverflow,
        statusesInside: statuses.every((status) => {
          if (!status) return false;
          const rect = status.getBoundingClientRect();
          return rect.left >= viewportRect.left && rect.right <= viewportRect.right;
        }),
      };
    },
    { hostId, threadId, longTitle },
  );
  expect(metrics).toEqual({
    overflow: 0,
    titleClipped: true,
    titleOverflow: "ellipsis",
    statusesInside: true,
  });
});
