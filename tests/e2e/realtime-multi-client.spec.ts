import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/remote-workspace";
import { openApp, reloadApp } from "./helpers/app";
import { chatViewportBottomDistance, revealVirtualizedChatLocator } from "./helpers/scroll";
import {
  activeRealtimeSocketCount,
  activeRealtimeSocketUrls,
  closeRealtimeSockets,
  installRealtimeSocketProbe,
  realtimeClientMessageCount,
  waitForRealtimeClientMessage,
} from "./helpers/realtime-socket-probe";
import { sendSteerText, sendTextTurn } from "./helpers/remote-codex";

test.describe.configure({ mode: "serial" });

test("fans out a real remote app-server thread to multiple browser clients across turns", async ({
  browser,
  page,
  remoteWorkspace,
}) => {
  const { remote } = remoteWorkspace;
  await installRealtimeSocketProbe(page);

  await openApp(page);
  await expect.poll(() => activeRealtimeSocketCount(page), { timeout: 10_000 }).toBe(1);
  expect((await activeRealtimeSocketUrls(page)).every(isTokenlessRealtimeUrl)).toBe(true);
  const resumePingOffset = await realtimeClientMessageCount(page);
  await triggerRealtimeResume(page);
  const resumePing = await waitForRealtimeClientMessage(page, "ping", resumePingOffset);
  expect(typeof resumePing.nonce).toBe("string");

  const { host, project } = await remoteWorkspace.provision();
  await expect(page.getByTestId("project-thread-list")).toBeVisible();
  const threadId = await remoteWorkspace.startThread(project.id);

  const firstMarker = `E2E 第一轮 ${Date.now()}`;
  await page
    .getByPlaceholder("输入后续修改要求")
    .fill(
      [
        `请执行一个较长命令，然后最终用一句话回复：${firstMarker}`,
        "运行 python - <<'PY'",
        "import time",
        `print('${firstMarker}')`,
        "time.sleep(12)",
        "print('first turn sleep finished')",
        "PY",
      ].join("\n"),
    );
  await page.getByTestId("send-turn-button").click();
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "停止生成");
  await expect(page.getByTestId(`thread-button-${threadId}`).getByLabel("运行中")).toBeVisible();
  await expect(
    page.getByTestId(`thread-button-${threadId}`).locator(".animate-spin"),
  ).toBeVisible();
  await expect.poll(async () => activeRemoteTurnId(page), { timeout: 30_000 }).not.toBe("");
  const steerMarker = `E2E steer ${Date.now()}`;
  const steerMessageOffset = await realtimeClientMessageCount(page);
  await sendSteerText(page, steerMarker);
  const steerMessage = await waitForRealtimeClientMessage(page, "turn.steer", steerMessageOffset);
  expect(steerMessage.threadId).toBe(threadId);
  expect(steerMessage.text).toContain(steerMarker);
  await expect(
    page
      .getByTestId("chat-scroll-area")
      .getByTestId("steered-conversation-item")
      .getByText(steerMarker),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("chat-scroll-area").getByText(firstMarker)).toBeVisible({
    timeout: 120_000,
  });
  const processToggle = firstIntermediateStepsToggle(page);
  if (
    (await processToggle.isVisible().catch(() => false)) &&
    (await processToggle.getAttribute("data-state")) !== "open"
  ) {
    await processToggle.click();
    await expect(processToggle).toHaveAttribute("data-state", "open");
  }
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "已完成", {
    timeout: 120_000,
  });
  await expect(page.getByTestId(`thread-button-${threadId}`).getByLabel("已完成")).toBeVisible();
  await expect(firstIntermediateStepsToggle(page)).toHaveAttribute("data-state", "closed");
  const reconnectedMarker = `E2E WS重连 ${Date.now()}`;
  await sendTextTurn(page, reconnectedMarker);
  await expect.poll(() => chatViewportBottomDistance(page)).toBeLessThanOrEqual(2);
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "停止生成");
  const reconnectMessageOffset = await realtimeClientMessageCount(page);
  await closeRealtimeSockets(page);
  await expect.poll(() => activeRealtimeSocketCount(page), { timeout: 30_000 }).toBe(1);
  const reconnectSubscription = await waitForRealtimeClientMessage(
    page,
    "thread.subscribe",
    reconnectMessageOffset,
  );
  expect(reconnectSubscription.threadId).toBe(threadId);
  expect(reconnectSubscription.afterEpoch).toEqual(expect.any(String));
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "已完成", {
    timeout: 120_000,
  });
  await expect(page.getByTestId(`thread-button-${threadId}`).getByLabel("已完成")).toBeVisible();
  await firstIntermediateStepsToggle(page).click();
  await revealVirtualizedChatLocator(
    page,
    page
      .getByTestId("chat-scroll-area")
      .getByTestId("steered-conversation-item")
      .getByText(steerMarker),
  );
  await reloadApp(page);
  await expect(firstIntermediateStepsToggle(page)).toHaveAttribute("data-state", "closed");
  await firstIntermediateStepsToggle(page).click();
  await revealVirtualizedChatLocator(
    page,
    page
      .getByTestId("chat-scroll-area")
      .getByTestId("steered-conversation-item")
      .getByText(steerMarker),
  );

  const backgroundThreadId = await remoteWorkspace.startThread(project.id);
  // startThread resolves from the App Server response before Vue has necessarily committed the
  // route and browser-local last-open selection. Capture storage only after the user-visible
  // selection has settled, otherwise the second browser can legitimately restore the prior tab.
  await expect
    .poll(async () => currentSelectedThreadId(page), { timeout: 30_000 })
    .toBe(backgroundThreadId);
  const secondContext = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  await openThreadFromProjectOrRestoredState(page, project.id, threadId);
  const secondPage = await secondContext.newPage();
  await installRealtimeSocketProbe(secondPage);
  await openApp(secondPage, { resetConfig: false });
  try {
    await expect.poll(() => activeRealtimeSocketCount(secondPage), { timeout: 10_000 }).toBe(1);
    // This scenario verifies cross-browser runtime fanout, not last-open restoration. Select the
    // background thread through the same project-tree action a user performs so the assertion does
    // not depend on which tab last wrote browser-local navigation while the new page was starting.
    await openThreadFromProjectOrRestoredState(secondPage, project.id, backgroundThreadId);
    await expect
      .poll(async () => currentSelectedThreadId(secondPage), { timeout: 30_000 })
      .toBe(backgroundThreadId);
    const backgroundStatusMarker = `E2E 跨浏览器侧边栏状态 ${Date.now()}`;
    await page
      .getByPlaceholder("输入后续修改要求")
      .fill(
        [
          `请执行较长命令后回复：${backgroundStatusMarker}`,
          `运行 sleep 8; printf '%s\\n' '${backgroundStatusMarker}'`,
        ].join("\n"),
      );
    await page.getByTestId("send-turn-button").click();
    await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "停止生成");
    await expect(
      secondPage.getByTestId(`thread-button-${threadId}`).getByLabel("运行中"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      secondPage.getByTestId(`recent-thread-button-${threadId}`).getByLabel("运行中"),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => threadRuntimeStatus(secondPage, host.id, threadId), { timeout: 30_000 })
      .toBe("running");
    await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "已完成", {
      timeout: 120_000,
    });
    await expect
      .poll(() => threadRuntimeStatus(secondPage, host.id, threadId), { timeout: 30_000 })
      .toBe("completed");

    await openThreadFromProjectOrRestoredState(secondPage, project.id, threadId);
    await expect(secondPage.getByPlaceholder("输入后续修改要求")).toBeEnabled();
    await expect
      .poll(async () => secondPage.getByTestId("chat-scroll-area").getByText(firstMarker).count(), {
        timeout: 120_000,
      })
      .toBeGreaterThan(0);
    await secondPage.getByTestId("chat-scroll-area").evaluate((root) => {
      const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (viewport !== null) viewport.scrollTop = viewport.scrollHeight;
    });
    await expect
      .poll(
        async () =>
          secondPage.getByTestId("chat-scroll-area").evaluate((root) => {
            const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
            if (viewport === null) return false;
            return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
          }),
        { timeout: 5_000 },
      )
      .toBe(true);

    await page.getByTestId(`thread-button-${threadId}`).click({ button: "right" });
    await page.getByRole("menuitem", { name: /置顶会话|Pin thread/ }).click();
    await expect(page.getByTestId(`pinned-thread-button-${threadId}`)).toBeVisible();
    await expect(secondPage.getByTestId(`pinned-thread-button-${threadId}`)).toBeVisible({
      timeout: 10_000,
    });

    await secondPage.getByTestId(`pinned-thread-button-${threadId}`).click({ button: "right" });
    await secondPage.getByRole("menuitem", { name: /取消置顶|Unpin thread/ }).click();
    await expect(secondPage.getByTestId(`pinned-thread-button-${threadId}`)).toBeHidden();
    await expect(page.getByTestId(`pinned-thread-button-${threadId}`)).toBeHidden({
      timeout: 10_000,
    });

    const secondMarker = `E2E 第二轮图片 ${Date.now()}`;
    await remoteWorkspace.sendImageTurn(secondPage, {
      hostId: host.id,
      threadId,
      cwd: remote.projectPath,
      imagePath: remote.imagePath,
      marker: secondMarker,
    });
    await expect(
      secondPage.getByTestId("chat-scroll-area").getByText(`回复：${secondMarker}`),
    ).toBeVisible({ timeout: 120_000 });
    // The response text can arrive before app-server emits turn/completed. Waiting on the page
    // that started the turn prevents the other client from satisfying "已完成" with the previous
    // turn's state before its queued turn/started event has been projected.
    await expect(secondPage.getByTestId("send-turn-button")).toHaveAttribute(
      "aria-label",
      "已完成",
      { timeout: 120_000 },
    );
    await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "已完成", {
      timeout: 120_000,
    });
    // Assistant text and a transient completed button can precede app-server's terminal turn event.
    // Starting the interrupt case before the authoritative active turn clears legitimately sends
    // turn.steer and tests a different operation. Wait on runtime identity rather than adding a
    // sleep or weakening the protocol assertion below.
    await expect.poll(async () => activeRemoteTurnId(page), { timeout: 120_000 }).toBe("");
    await revealVirtualizedChatLocator(
      page,
      page.getByTestId("chat-scroll-area").getByText(`回复：${secondMarker}`),
    );
    expect(await activeRealtimeSocketCount(page)).toBe(1);
    expect(await activeRealtimeSocketCount(secondPage)).toBe(1);
  } finally {
    await secondContext.close();
  }

  const interruptMarker = `E2E interrupt ${Date.now()}`;
  const turnStartMessageOffset = await realtimeClientMessageCount(page);
  await page
    .getByPlaceholder("输入后续修改要求")
    .fill(
      [
        `请执行一个较长命令来等待中断：${interruptMarker}`,
        "运行 python - <<'PY'",
        "import time",
        "time.sleep(30)",
        "print('interrupt target finished')",
        "PY",
      ].join("\n"),
    );
  await page.getByTestId("send-turn-button").click();
  const turnStartMessage = await waitForRealtimeClientMessage(
    page,
    "turn.start",
    turnStartMessageOffset,
  );
  expect(turnStartMessage.threadId).toBe(threadId);
  await expect.poll(async () => activeRemoteTurnId(page), { timeout: 30_000 }).not.toBe("");
  const activeTurnId = await activeRemoteTurnId(page);
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute("aria-label", "停止生成");
  const interruptMessageOffset = await realtimeClientMessageCount(page);
  await page.getByTestId("stop-turn-button").click();
  const interruptMessage = await waitForRealtimeClientMessage(
    page,
    "turn.interrupt",
    interruptMessageOffset,
  );
  expect(interruptMessage.threadId).toBe(threadId);
  expect(interruptMessage.turnId).toBe(activeTurnId);
});

function isTokenlessRealtimeUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  return url.pathname === "/api/realtime" && url.search === "";
}

function firstIntermediateStepsToggle(page: Page) {
  return page.getByRole("button", { name: /中间过程/ }).first();
}

async function openThreadFromProjectOrRestoredState(
  page: Page,
  projectId: number,
  threadId: string,
) {
  if ((await currentSelectedThreadId(page)) === threadId) {
    return;
  }

  await expect(page.getByTestId(`project-button-${projectId}`)).toBeVisible();
  const row = page.getByTestId(`project-thread-row-${threadId}`);
  if (!(await row.isVisible().catch(() => false))) {
    await page.getByTestId(`project-button-${projectId}`).click();
  }
  if ((await currentSelectedThreadId(page)) === threadId) {
    return;
  }
  const threadButton = page.getByTestId(`thread-button-${threadId}`);
  if (await threadButton.isVisible().catch(() => false)) {
    await threadButton.click();
    await expect
      .poll(async () => currentSelectedThreadId(page), { timeout: 10_000 })
      .toBe(threadId);
    return;
  }
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect.poll(async () => currentSelectedThreadId(page), { timeout: 10_000 }).toBe(threadId);
}

async function currentRouteThreadId(page: Page) {
  return page.evaluate(() => new URLSearchParams(window.location.search).get("threadId"));
}

async function currentSelectedThreadId(page: Page) {
  const storeThreadId = await page.evaluate(() => {
    const navigation = window.__codexGatewayE2e?.navigation;
    return navigation?.selectedThreadId !== null && navigation?.selectedThreadId !== undefined
      ? String(navigation.selectedThreadId)
      : null;
  });
  return storeThreadId ?? (await currentRouteThreadId(page));
}

async function triggerRealtimeResume(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function activeRemoteTurnId(page: Page) {
  return page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const { navigation, runtime, views } = driver;
    const turns = views.history?.thread.turns ?? [];
    const latest = [...turns].reverse().find((turn) => {
      const status =
        typeof turn.status === "string"
          ? turn.status
          : turn.status !== null &&
              turn.status !== undefined &&
              typeof turn.status.type === "string"
            ? turn.status.type
            : null;
      return status === "inProgress" || status === "running" || status === "active";
    });
    if (latest?.id !== null && latest?.id !== undefined) {
      return String(latest.id);
    }
    const key =
      navigation.selectedHostId !== null &&
      navigation.selectedThreadId !== null &&
      navigation.selectedThreadId !== ""
        ? `${navigation.selectedHostId}:${navigation.selectedThreadId}`
        : "";
    return String(runtime.activeTerminalProcessByThreadKey[key]?.turnId ?? "");
  });
}

async function threadRuntimeStatus(page: Page, hostId: number, threadId: string) {
  return page.evaluate(
    ({ hostId, threadId }) =>
      window.__codexGatewayE2e?.runtime.threadStatuses[`${hostId}:${threadId}`] ?? "idle",
    { hostId, threadId },
  );
}
