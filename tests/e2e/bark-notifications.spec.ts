import { expect, test } from "./fixtures/remote-workspace";
import { openApp } from "./helpers/app";
import { configureBarkNotifications, useBarkReceiver } from "./helpers/bark";
import { sendTextTurn } from "./helpers/remote-codex";
import { sendRealtimeRequest } from "./helpers/realtime";

test("Bark sends ordinary turn notifications and only notifies when an app-server goal ends", async ({
  page,
  remoteWorkspace,
}) => {
  const bark = await useBarkReceiver();
  await openApp(page);
  await configureBarkNotifications(page, bark.url);

  const { host, project } = await remoteWorkspace.provision({
    hostName: `bark-notification-host-${Date.now()}`,
  });
  const threadId = await remoteWorkspace.startThread(project.id);

  await sendTextTurn(page, `E2E 普通通知 ${Date.now()}`);
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Completed|已完成/,
    { timeout: 120_000 },
  );
  await expect.poll(async () => (await bark.readRequests()).length, { timeout: 30_000 }).toBe(1);
  const threadTitle = await page
    .getByTestId(`thread-button-${threadId}`)
    .locator("[title]")
    .first()
    .getAttribute("title");
  expect(threadTitle).toBeTruthy();
  const completionRequest = (await bark.readRequests())[0];
  expect(completionRequest?.title).toBe(threadTitle);
  expect(completionRequest?.body).toBe("");
  const turnToast = page.locator("[data-sonner-toast]").filter({ hasText: threadTitle! });
  await expect(turnToast).toBeVisible();
  await turnToast.getByRole("button", { name: /Open thread|打开会话/ }).click();
  await expect(page).toHaveURL(new RegExp(`threadId=${threadId}`));

  await sendRealtimeRequest(page, {
    type: "thread.goal.set",
    requestId: `goal-active-${Date.now()}`,
    hostId: host.id,
    threadId,
    objective: "验证 Bark 只在目标整体结束时通知",
    tokenBudget: null,
  });
  await expect(page.getByTestId("composer-mode-strip").getByText("目标").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(2_000);
  expect(await bark.readRequests()).toHaveLength(1);

  await sendRealtimeRequest(page, {
    type: "thread.goal.set",
    requestId: `goal-complete-${Date.now()}`,
    hostId: host.id,
    threadId,
    status: "complete",
  });
  await expect.poll(async () => (await bark.readRequests()).length, { timeout: 30_000 }).toBe(2);
  const requests = await bark.readRequests();
  expect(requests[1]?.title).toContain("Goal finished");
  expect(requests[1]?.body).toContain("Ran for");
  expect(requests[1]?.body).toContain("tokens");
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Goal finished" }),
  ).toBeVisible();
});

test("Bark keeps monitoring an active main turn after the last browser closes", async ({
  page,
  remoteWorkspace,
}) => {
  const bark = await useBarkReceiver();
  await openApp(page);
  await configureBarkNotifications(page, bark.url);

  const { project } = await remoteWorkspace.provision({
    hostName: `bark-handoff-host-${Date.now()}`,
  });
  await remoteWorkspace.startThread(project.id);
  await page
    .getByPlaceholder(/Ask for follow-up changes|输入后续修改要求/)
    .fill(
      [
        "运行下面的命令，命令结束后简短回复。",
        "python - <<'PY'",
        "import time",
        "time.sleep(8)",
        "print('browser lease handoff finished')",
        "PY",
      ].join("\n"),
    );
  await page.getByTestId("send-turn-button").click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__codexGatewayE2e?.views.events.filter(
              (event) => event.method === "turn/started",
            ).length ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.close();

  // Closing the last browser releases its UI lease, not the active app-server subscription.
  // The background monitor must own it until turn/completed so VS Code-only and closed-page
  // workflows receive the same completion notification as an open Gateway page.
  await expect.poll(async () => (await bark.readRequests()).length, { timeout: 60_000 }).toBe(1);
  const completionRequest = (await bark.readRequests())[0];
  expect(completionRequest?.title).not.toContain("Turn finished");
  expect(completionRequest?.body).toBe("");
});

test("Bark does not notify when the user stops an active turn", async ({
  page,
  remoteWorkspace,
}) => {
  const bark = await useBarkReceiver();
  await openApp(page);
  await configureBarkNotifications(page, bark.url);

  const { project } = await remoteWorkspace.provision({
    hostName: `bark-stopped-turn-host-${Date.now()}`,
  });
  await remoteWorkspace.startThread(project.id);
  await page
    .getByPlaceholder(/Ask for follow-up changes|输入后续修改要求/)
    .fill(
      [
        "运行下面的命令，等待我手动停止，不要提前回复。",
        "python - <<'PY'",
        "import time",
        "time.sleep(30)",
        "print('stopped turn unexpectedly finished')",
        "PY",
      ].join("\n"),
    );
  await page.getByTestId("send-turn-button").click();
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Stop generation|停止生成/,
    { timeout: 30_000 },
  );
  const toastCountBeforeStop = await page.locator("[data-sonner-toast]").count();
  await page.getByTestId("stop-turn-button").click();
  await expect(page.getByTestId("send-turn-button")).toHaveAttribute(
    "aria-label",
    /Interrupted|已中断/,
    { timeout: 30_000 },
  );

  // Delivery is asynchronous after the terminal event. Give the notification center enough time
  // to publish if the interrupted turn were incorrectly considered eligible.
  await page.waitForTimeout(2_000);
  expect(await bark.readRequests()).toHaveLength(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(toastCountBeforeStop);
});

test("plan-mode user questions render and notify through Sonner and Bark", async ({
  page,
  remoteWorkspace,
}) => {
  const bark = await useBarkReceiver();
  await openApp(page);
  await configureBarkNotifications(page, bark.url);

  const hostName = `bark-plan-question-host-${Date.now()}`;
  const { project } = await remoteWorkspace.provision({ hostName });
  await remoteWorkspace.startThread(project.id);
  await page.getByPlaceholder(/Ask for follow-up changes|输入后续修改要求/).fill("/");
  await page.getByTestId("slash-command-plan").click();
  await expect(page.getByTestId("composer-mode-strip").getByText("计划模式").first()).toBeVisible();

  const question = `请选择 E2E 方案 ${Date.now()}`;
  await page
    .getByPlaceholder(/Ask for follow-up changes|输入后续修改要求/)
    .fill(
      `先不要制定计划或回复正文。立即调用 request_user_input，只询问“${question}”，提供“方案 A”和“方案 B”两个选项。`,
    );
  await page.getByTestId("send-turn-button").click();

  const requestCard = page.getByTestId("chat-scroll-area").getByText(question, { exact: true });
  await expect(requestCard).toBeVisible({ timeout: 120_000 });
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Awaiting your response" }),
  ).toBeVisible();
  await expect.poll(async () => (await bark.readRequests()).length, { timeout: 30_000 }).toBe(1);
  const request = (await bark.readRequests())[0];
  expect(request?.title).toContain("Awaiting your response");
  expect(request?.body).toContain(hostName);
  expect(request?.body).toContain(question);
  expect(request?.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
