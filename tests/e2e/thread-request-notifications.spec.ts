import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import {
  applyGatewayLiveEvent,
  capturedRealtimeInterrupt,
  capturedServerRequestResponse,
  interruptActiveTurnInStore,
  installRealtimeInterruptMock,
  installServerRequestResponderMock,
  seedGatewayThread,
} from "./helpers/gateway-store";

test("desktop browsers keep in-app notification toasts", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    driver.publishNotification({
      key: "e2e-desktop-in-app-notification",
      title: "Turn finished",
      body: "Desktop browser notification remains available.",
      target: { kind: "thread", hostId: 1, projectId: 1, threadId: "desktop-notification" },
    });
  });

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Turn finished" }),
  ).toBeVisible();
});

test("desktop turn completion notifications play one chime and ignore other notifications", async ({
  page,
}) => {
  await page.addInitScript(() => {
    type AudioTestWindow = Window & { __completionSoundOscillatorStarts?: number };
    const testWindow = window as AudioTestWindow;

    class FakeAudioParam {
      setValueAtTime() {}
      exponentialRampToValueAtTime() {}
    }

    class FakeOscillator {
      type = "sine";
      frequency = new FakeAudioParam();
      connect() {}
      start() {
        testWindow.__completionSoundOscillatorStarts =
          (testWindow.__completionSoundOscillatorStarts ?? 0) + 1;
      }
      stop() {}
    }

    class FakeGain {
      gain = new FakeAudioParam();
      connect() {}
    }

    class FakeAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      async resume() {
        this.state = "running";
      }
      createOscillator() {
        return new FakeOscillator();
      }
      createGain() {
        return new FakeGain();
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
  });
  await openApp(page);

  await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const completed = {
      key: "thread-terminal:e2e:thread:turn:completed",
      title: "Turn finished",
      body: "Completed",
      target: { kind: "thread" as const, hostId: 1, projectId: 1, threadId: "e2e" },
    };
    driver.publishNotification(completed);
    driver.publishNotification(completed);
    driver.publishNotification({
      key: "thread-user-input:e2e:thread:request",
      title: "Awaiting response",
      body: "Open the thread",
      target: { kind: "thread", hostId: 1, projectId: 1, threadId: "e2e" },
    });
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __completionSoundOscillatorStarts?: number })
            .__completionSoundOscillatorStarts ?? 0,
      ),
    )
    .toBe(2);
});

test("background desktop browsers show a native notification for completed turns", async ({
  page,
}) => {
  await page.addInitScript(() => {
    type NotificationTestWindow = Window & { __desktopNotificationCount?: number };
    const testWindow = window as NotificationTestWindow;

    class FakeNotification {
      static permission: NotificationPermission = "granted";
      static async requestPermission() {
        return "granted" as NotificationPermission;
      }
      onclick: (() => void) | null = null;

      constructor() {
        testWindow.__desktopNotificationCount = (testWindow.__desktopNotificationCount ?? 0) + 1;
      }

      close() {}
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: FakeNotification,
    });
    window.localStorage.setItem("codex-gateway.desktop-notifications", "1");
  });
  await openApp(page);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    const completed = {
      key: "thread-terminal:e2e:background:turn:completed",
      title: "Turn finished",
      body: "Completed in the background",
      target: { kind: "thread" as const, hostId: 1, projectId: 1, threadId: "background" },
    };
    driver.publishNotification(completed);
    driver.publishNotification(completed);
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __desktopNotificationCount?: number }).__desktopNotificationCount ??
          0,
      ),
    )
    .toBe(1);
});

test("dynamic tool response submits through the server request responder and surfaces failures", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-dynamic-tool-thread";
  await seedGatewayThread(page, {
    hostId: 7,
    projectId: 3,
    threadId,
    currentThread: { id: threadId, name: "Dynamic Tool" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "turn-dynamic-tool",
            status: "running",
            items: [
              {
                id: "server-request-42",
                type: "dynamicToolClientRequest",
                turnId: "turn-dynamic-tool",
                status: "waitingForClient",
                requestId: 42,
                method: "item/tool/call",
                params: {
                  namespace: "codex_app",
                  tool: "read_thread_terminal",
                  arguments: {},
                },
              },
            ],
          },
        ],
      },
    },
  });

  await installServerRequestResponderMock(page, {
    mode: "capture",
  });

  await page.getByTestId("dynamic-tool-submit").click();
  await expect
    .poll(() => capturedServerRequestResponse(page))
    .toMatchObject({
      hostId: 7,
      threadId: "e2e-dynamic-tool-thread",
      serverRequestId: 42,
      result: {
        contentItems: [{ type: "inputText", text: "" }],
        success: true,
      },
    });
  await expect(page.getByTestId("dynamic-tool-submit")).toBeEnabled();

  await installServerRequestResponderMock(page, {
    mode: "fail",
    message: "pending app-server request was not found",
  });

  await page.getByTestId("dynamic-tool-submit").click();
  await expect(page.getByText("pending app-server request was not found")).toBeVisible();
  await expect(
    page.getByTestId("chat-scroll-area").getByText("pending app-server request was not found"),
  ).toHaveCount(0);

  await applyGatewayLiveEvent(page, {
    id: 43,
    hostId: 7,
    threadId,
    method: "serverRequest/resolved",
    payload: { method: "serverRequest/resolved", params: { threadId, requestId: 42 } },
    createdAt: new Date().toISOString(),
  });
  await expect(page.getByTestId("dynamic-tool-submit")).toBeHidden();
  await expect(page.getByText("请求已处理")).toBeVisible();
});

test("app-server error notifications use Sonner without entering the timeline", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-app-server-error-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Error Notification" },
    history: { thread: { id: threadId, turns: [] } },
  });
  await applyGatewayLiveEvent(page, {
    id: 101,
    hostId: 1,
    threadId,
    method: "error",
    payload: {
      method: "error",
      params: {
        threadId,
        turnId: "turn-error",
        willRetry: true,
        error: {
          message: "remote provider disconnected",
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
          additionalDetails: "stream closed before final response",
        },
      },
    },
    createdAt: new Date().toISOString(),
  });

  const chatScrollArea = page.getByTestId("chat-scroll-area");
  await expect(page.getByText(/remote provider disconnected/)).toBeVisible();
  await expect(page.getByText(/错误类型：responseStreamDisconnected/)).toBeVisible();
  await expect(page.getByText(/app-server 正在自动重试/)).toBeVisible();
  await expect(chatScrollArea.getByText("remote provider disconnected")).toHaveCount(0);

  await applyGatewayLiveEvent(page, {
    id: 102,
    hostId: 1,
    threadId,
    method: "item/agentMessage/delta",
    payload: {
      method: "item/agentMessage/delta",
      params: {
        threadId,
        turnId: "turn-error",
        itemId: "agent-recovered",
        delta: "retry recovered",
      },
    },
    createdAt: new Date().toISOString(),
  });

  await expect(chatScrollArea.getByText("retry recovered")).toBeVisible();
});

test("app-server moderation notifications render a readable summary before raw details", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "e2e-moderation-notification-thread";
  await seedGatewayThread(page, {
    threadId,
    currentThread: { id: threadId, name: "Moderation Notification" },
    history: { thread: { id: threadId, turns: [] } },
  });
  await applyGatewayLiveEvent(page, {
    id: 201,
    hostId: 1,
    threadId,
    method: "turn/moderationMetadata",
    payload: {
      method: "turn/moderationMetadata",
      params: {
        threadId,
        turnId: "turn-moderation",
        metadata: {
          flagged: true,
          model: "omni-moderation-latest",
          categories: { self_harm: true, violence: false },
          raw: "only visible after expanding details",
        },
      },
    },
    createdAt: new Date().toISOString(),
  });

  const chatScrollArea = page.getByTestId("chat-scroll-area");
  await expect(chatScrollArea.getByText("安全审查元数据")).toBeVisible();
  await expect(chatScrollArea.getByText(/flagged=true/)).toBeVisible();
  await expect(chatScrollArea.getByText(/categories=self_harm/)).toBeVisible();
  await expect(chatScrollArea.getByText("only visible after expanding details")).toBeHidden();
  await chatScrollArea.getByRole("button", { name: "查看详情" }).click();
  await expect(chatScrollArea.getByText("only visible after expanding details")).toBeVisible();
});

test("terminal wait notifications mention the command being watched", async ({ page }) => {
  await openApp(page);
  await seedGatewayThread(page, {
    threadId: "e2e-terminal-wait-thread",
    currentThread: { id: "e2e-terminal-wait-thread", name: "Terminal Wait" },
    history: { thread: { id: "e2e-terminal-wait-thread", turns: [] } },
  });
  await applyGatewayLiveEvent(page, {
    id: 301,
    hostId: 1,
    threadId: "e2e-terminal-wait-thread",
    method: "item/started",
    payload: {
      method: "item/started",
      params: {
        threadId: "e2e-terminal-wait-thread",
        turnId: "turn-terminal",
        startedAtMs: Date.now(),
        item: {
          id: "cmd-watch",
          type: "commandExecution",
          command: "/bin/bash -lc 'pnpm dev'",
          cwd: "/workspace/codex-gateway",
          processId: "proc-123",
          status: "inProgress",
          aggregatedOutput: "",
          exitCode: null,
          durationMs: null,
        },
      },
    },
    createdAt: new Date().toISOString(),
  });
  await applyGatewayLiveEvent(page, {
    id: 302,
    hostId: 1,
    threadId: "e2e-terminal-wait-thread",
    method: "item/commandExecution/terminalInteraction",
    payload: {
      method: "item/commandExecution/terminalInteraction",
      params: {
        threadId: "e2e-terminal-wait-thread",
        turnId: "turn-terminal",
        itemId: "cmd-watch",
        processId: "proc-123",
        stdin: "",
      },
    },
    createdAt: new Date().toISOString(),
  });

  const chatScrollArea = page.getByTestId("chat-scroll-area");
  await expect(
    chatScrollArea.getByText("agent 正在等待命令：pnpm dev", { exact: true }),
  ).toBeVisible();

  await installRealtimeInterruptMock(page);

  await interruptActiveTurnInStore(page);

  await expect
    .poll(() => capturedRealtimeInterrupt(page))
    .toMatchObject({
      type: "turn.interrupt",
      hostId: 1,
      threadId: "e2e-terminal-wait-thread",
      turnId: "turn-terminal",
    });
});
