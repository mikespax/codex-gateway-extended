import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures/remote-workspace";
import { authenticatedFetch, openApp, reloadApp } from "./helpers/app";
import { hostRecordSchema, projectRecordSchema } from "./helpers/http-schemas";
import {
  appendAgentStreamLines,
  installSelectedThreadGoalSubmitMock,
  seedGatewayThread,
} from "./helpers/gateway-store";
import { defaultGatewayHost } from "./fixtures/thread-history";
import { gatewayThreadFixture } from "./fixtures/gateway-thread";
import {
  buildTextTurns,
  frameSpread,
  installDeferredThreadTurnsLoadStub,
  requestOlderTurnsFromStore,
  releaseDeferredThreadTurnsLoad,
  startBottomDistanceTracking,
  startLocatorTopTracking,
  stopFrameTracking,
  threadTurnCount,
  threadTurnsLoadRequests,
  waitForAnimationFrames,
} from "./helpers/history-pagination";
import {
  captureVisibleTimelineRowAnchor,
  continueChatTouchScrollUp,
  continueChatTouchMomentumUp,
  endChatTouchScroll,
  expectSyntheticWebKitTouchToRemainReadable,
  scrollChatViewportToTop,
  startChatTouchScrollUp,
  visibleTimelineRowTop,
  waitForScrollableChatViewportAtBottom,
  waitForChatScrollToSettle,
} from "./helpers/scroll";
import {
  execRemoteSsh,
  type RemoteCodexEnv,
  waitForSelectedThreadId,
} from "./helpers/remote-codex";

test("uses the mobile layout with hidden sidebar and usable composer shell", async ({ page }) => {
  await page.route("**/api/hosts/1/codex-usage", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hostId: 1,
        limitId: "codex",
        limitName: "Codex",
        planType: "pro",
        primary: {
          usedPercent: 27,
          remainingPercent: 73,
          windowDurationMins: 300,
          resetsAt: null,
        },
        secondary: null,
        observedAt: Date.now(),
      }),
    });
  });
  await openApp(page);
  const threadId = "mobile-header-usage";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile header usage" },
  });

  await expect(page.getByTestId("mobile-layout")).toBeVisible();
  await expect(page.getByTestId("desktop-layout")).toBeHidden();
  await expect(page.getByTestId("settings-toggle")).toBeHidden();

  await page.getByTestId("mobile-sidebar-toggle").click();
  await expect(page.getByTestId("settings-toggle")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-toggle")).toBeHidden();

  await expect(page.getByTestId("chat-scroll-area")).toBeVisible();
  await expect(page.getByTestId("codex-usage-badge")).toHaveText("73%");
  await expect(page.getByTestId("codex-usage-badge")).toHaveAttribute("aria-label", /73%/);
  await expect(page.getByTestId("decrease-chat-text-size")).toBeVisible();
  await expect(page.getByTestId("increase-chat-text-size")).toBeVisible();
  await expect(page.getByTestId("open-tmux-mobile-button")).toHaveCount(0);
  await expect(page.getByTestId("open-host-monitor-mobile-button")).toHaveCount(0);
  await expect(page.getByTestId("open-browser-mobile-button")).toHaveCount(0);
  await expect(page.getByTestId("open-terminal-mobile-button")).toHaveCount(0);

  const titleBox = await page.getByTestId("mobile-thread-title").boundingBox();
  expect(titleBox).not.toBeNull();
  expect(titleBox!.width).toBeGreaterThan(120);
});

test("persists chat-only text size controls in the mobile header", async ({ page }) => {
  await openApp(page);
  const threadId = "mobile-chat-text-size";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile chat text size" },
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "mobile-chat-text-size-turn",
            status: "completed",
            items: [
              {
                id: "mobile-chat-text-size-user",
                type: "userMessage",
                content: [{ type: "text", text: "Keep the composer size unchanged." }],
              },
              {
                id: "mobile-chat-text-size-agent",
                type: "agentMessage",
                phase: "final_answer",
                text: "Increase only the conversation text.",
              },
            ],
          },
        ],
      },
    },
  });

  const timeline = page.getByTestId("chat-scroll-area");
  const conversationText = timeline.locator(".markdown-content").last();
  const composer = page.getByTestId("composer-input");
  await expect(timeline).toHaveAttribute("data-chat-text-size", "default");
  await expect(conversationText).toBeVisible();

  const initialConversationSize = await conversationText.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  const initialComposerSize = await composer.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );

  await page.getByTestId("increase-chat-text-size").click();
  await expect(timeline).toHaveAttribute("data-chat-text-size", "large");

  const increasedConversationSize = await conversationText.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  const unchangedComposerSize = await composer.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(increasedConversationSize).toBeGreaterThan(initialConversationSize);
  expect(unchangedComposerSize).toBe(initialComposerSize);

  const storageState = await page.context().storageState();
  const persistedPreferences = storageState.origins
    .flatMap((origin) => origin.localStorage)
    .filter(({ name }) => name.endsWith(":chat-text-size"))
    .map(({ value }) => value);
  expect(persistedPreferences).toContain("large");

  await page.getByTestId("decrease-chat-text-size").click();
  await expect(timeline).toHaveAttribute("data-chat-text-size", "default");
});

test("expands the focused composer in a keyboard-sized mobile viewport", async ({ page }) => {
  await openApp(page);
  const threadId = "mobile-focused-composer";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile focused composer" },
  });

  const composer = page.getByTestId("composer-input");
  await composer.fill(
    Array.from(
      { length: 18 },
      (_, index) => `Draft line ${index + 1} stays reviewable while the mobile keyboard is open.`,
    ).join("\n"),
  );
  await composer.focus();
  await page.setViewportSize({ width: 393, height: 520 });
  await waitForAnimationFrames(page, 3);

  const metrics = await composer.evaluate((element) => {
    const editor = element.closest<HTMLElement>(".cm-editor");
    const scroller = editor?.querySelector<HTMLElement>(".cm-scroller");
    const selection = window.getSelection();
    const caret =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
    const editorBox = editor?.getBoundingClientRect();
    const scrollerBox = scroller?.getBoundingClientRect();
    return {
      caretBottom: caret?.bottom ?? null,
      caretTop: caret?.top ?? null,
      editorBottom: editorBox?.bottom ?? null,
      editorHeight: editorBox?.height ?? 0,
      scrollTop: scroller?.scrollTop ?? 0,
      scrollerBottom: scrollerBox?.bottom ?? null,
      scrollerTop: scrollerBox?.top ?? null,
      viewportHeight: window.innerHeight,
    };
  });

  expect(metrics.editorHeight).toBeGreaterThan(metrics.viewportHeight * 0.28);
  expect(metrics.editorHeight).toBeLessThanOrEqual(metrics.viewportHeight * 0.5);
  expect(metrics.editorBottom).not.toBeNull();
  expect(metrics.editorBottom!).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.scrollTop).toBeGreaterThan(0);
  expect(metrics.caretTop).not.toBeNull();
  expect(metrics.caretBottom).not.toBeNull();
  expect(metrics.scrollerTop).not.toBeNull();
  expect(metrics.scrollerBottom).not.toBeNull();
  expect(metrics.caretTop!).toBeGreaterThanOrEqual(metrics.scrollerTop!);
  expect(metrics.caretBottom!).toBeLessThanOrEqual(metrics.scrollerBottom!);

  const composerSurfaceBox = await page.getByTestId("composer-surface").boundingBox();
  expect(composerSurfaceBox).not.toBeNull();
  expect(
    metrics.viewportHeight - composerSurfaceBox!.y - composerSurfaceBox!.height,
  ).toBeGreaterThanOrEqual(15);
});

test("keeps plain Enter multiline and enables browser text assistance", async ({ page }) => {
  await openApp(page);
  const threadId = "mobile-multiline-composer";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile multiline composer" },
  });

  const composer = page.getByTestId("composer-input");
  await expect(composer).toHaveAttribute("spellcheck", "true");
  await expect(composer).toHaveAttribute("autocapitalize", "sentences");
  await expect(composer).toHaveAttribute("autocorrect", "on");
  await expect(composer).toHaveAttribute("enterkeyhint", "enter");

  await composer.fill("Keep this draft");
  await composer.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("on a second line");

  await expect(composer).toHaveAttribute("data-value", "Keep this draft\non a second line");
});

test("recalls the latest request above active intermediate work", async ({ page }) => {
  await openApp(page);
  const threadId = "mobile-active-request-recall";
  const latestRequest = [
    "Audit the production workflow and preserve the existing safety gates.",
    "Keep customer sends disabled while validating the current worker, queue, and dashboard state.",
    "Report the evidence and the safest next action before changing any external service.",
  ].join(" ");
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Active request recall" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "active-request-recall-turn",
            status: "inProgress",
            items: [
              {
                id: "active-request-recall-user",
                type: "userMessage",
                content: [{ type: "text", text: latestRequest }],
              },
              {
                id: "active-request-recall-reasoning",
                type: "reasoning",
                status: "inProgress",
                summary: ["Checking the current production state"],
              },
              {
                id: "active-request-recall-search",
                type: "webSearch",
                status: "inProgress",
                query: "current production notification layout and mobile background activity",
              },
            ],
          },
        ],
      },
    },
  });

  const userMessage = page.getByText(latestRequest, { exact: true });
  const intermediateToggle = page.getByRole("button", { name: /Intermediate steps|中间过程/ });
  await expect(userMessage).toBeVisible();
  await expect(page.getByTestId("active-prompt-recall")).toHaveCount(0);
  await expect(intermediateToggle).toBeVisible();
  await expect(intermediateToggle).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("intermediate-steps-working")).toBeVisible();
  await expect(page.getByTestId("stop-turn-button")).toBeHidden();
  await expect(page.getByTestId("send-turn-button")).toBeVisible();

  const [messageBox, toggleBox] = await Promise.all([
    userMessage.boundingBox(),
    intermediateToggle.boundingBox(),
  ]);
  expect(messageBox).not.toBeNull();
  expect(toggleBox).not.toBeNull();
  expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(toggleBox!.y);
});

test("native Android delivery replaces mobile browser notification toasts", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const driver = window.__codexGatewayE2e;
    if (!driver) throw new Error("Gateway E2E driver is unavailable");
    driver.publishNotification({
      key: "e2e-mobile-native-notification",
      title: "Turn finished",
      body: "This notification should only appear in the native companion app.",
      target: { kind: "thread", hostId: 1, projectId: 1, threadId: "mobile-notification" },
    });
  });

  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Turn finished" }),
  ).toHaveCount(0);
});

test("shows effort and compact context usage without mobile approval controls", async ({
  page,
}) => {
  await openApp(page);
  const settingsUpdates: Array<Record<string, unknown>> = [];
  await page.route("**/api/threads/settings", async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("settings request body must be an object");
    }
    settingsUpdates.push(asRecord(body));
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const threadId = "mobile-composer-settings";
  const tokenBreakdown = {
    totalTokens: 50_000,
    inputTokens: 45_000,
    cachedInputTokens: 20_000,
    cacheWriteInputTokens: 0,
    outputTokens: 5_000,
    reasoningOutputTokens: 2_000,
  };
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile composer settings" },
    threadSettings: { model: "gpt-5.6-luna", effort: "medium", approvalPolicy: "never" },
    models: [
      {
        id: "gpt-5.6-luna",
        model: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
        serviceTiers: [{ id: "fast", name: "Fast", description: "Prioritize lower latency" }],
      },
      {
        id: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
        serviceTiers: [{ id: "fast", name: "Fast", description: "Prioritize lower latency" }],
      },
    ],
    tokenUsage: {
      total: tokenBreakdown,
      last: tokenBreakdown,
      modelContextWindow: 100_000,
    },
  });

  await expect(page.getByTestId("model-select")).toContainText("GPT-5.6 Luna");
  await expect(page.getByTestId("model-select")).toContainText("Medium");
  await expect(page.getByText("完全访问", { exact: true })).toBeHidden();
  const contextMeter = page.getByTestId("context-usage-meter");
  await expect(contextMeter).toBeVisible();
  await expect(contextMeter).toHaveAttribute("aria-label", /50%/);
  await expect(contextMeter.getByText("50%", { exact: true })).toBeHidden();

  await page.getByTestId("model-select").click();
  await expect(page.getByTestId("model-selector-dialog")).toBeVisible();
  await expect(page.getByTestId("reasoning-effort-select")).toContainText("Medium");
  await expect(page.getByTestId("model-dropdown-select")).toContainText("GPT-5.6 Luna");

  await page.getByTestId("reasoning-effort-select").click();
  await page.getByTestId("effort-option-high").click();
  await page.getByTestId("model-dropdown-select").click();
  await expect(page.getByTestId("model-option-gpt-5.6-luna")).toBeVisible();
  await page.getByTestId("model-option-gpt-5.6-sol").click();
  await expect(page.getByTestId("model-select")).toContainText("Medium");
  await expect(page.getByTestId("model-select")).toContainText("GPT-5.6 Luna");
  expect(settingsUpdates).toHaveLength(0);

  await page.getByTestId("model-selector-cancel").click();
  await expect(page.getByTestId("model-selector-dialog")).toBeHidden();
  await expect(page.getByTestId("model-select")).toContainText("Medium");
  await expect(page.getByTestId("model-select")).toContainText("GPT-5.6 Luna");

  await page.getByTestId("model-select").click();
  await page.getByTestId("reasoning-effort-select").click();
  await page.getByTestId("effort-option-high").click();
  await page.getByTestId("model-dropdown-select").click();
  await page.getByTestId("model-option-gpt-5.6-sol").click();
  await page.getByTestId("service-tier-select").click();
  await page.getByTestId("service-tier-option-fast").click();
  await page.getByTestId("model-selector-ok").click();
  await expect(page.getByTestId("model-selector-dialog")).toBeHidden();
  await expect(page.getByTestId("model-select")).toContainText("High");
  await expect(page.getByTestId("model-select")).toContainText("GPT-5.6 Sol");
  expect(settingsUpdates).toHaveLength(1);
  expect(settingsUpdates[0]).toMatchObject({
    hostId: 1,
    threadId,
    model: "gpt-5.6-sol",
    effort: "high",
    serviceTier: "fast",
  });

  await page.getByTestId("model-select").click();
  await page.getByTestId("reasoning-effort-select").click();
  await page.getByTestId("effort-option-low").click();
  await page.getByTestId("model-selector-close").click();
  await expect(page.getByTestId("model-selector-dialog")).toBeHidden();
  await expect(page.getByTestId("model-select")).toContainText("High");
  await page.getByTestId("model-select").click();
  await expect(page.getByTestId("model-selector-dialog")).toBeVisible();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId("model-selector-dialog")).toBeHidden();
  expect(settingsUpdates).toHaveLength(1);

  const attachmentInput = page.getByTestId("attachment-input");
  await expect(page.getByTestId("attachment-button")).toBeVisible();
  await page.getByTestId("attachment-button").click();
  await expect(page.getByTestId("attach-documents-option")).toBeVisible();
  await expect(page.getByTestId("attach-media-option")).toBeVisible();
  const documentChooser = page.waitForEvent("filechooser");
  await page.getByTestId("attach-documents-option").click();
  expect((await documentChooser).isMultiple()).toBe(true);

  await page.getByTestId("attachment-button").click();
  await expect(page.getByTestId("attach-media-option")).toBeVisible();
  await page.keyboard.press("Escape");

  const mediaAttachmentInput = page.getByTestId("media-attachment-input");
  await expect(attachmentInput).toHaveAttribute("accept", /application\/\*/);
  await expect(mediaAttachmentInput).toHaveAttribute("accept", "image/*,video/*");
  await mediaAttachmentInput.setInputFiles({
    name: "mobile-preview.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByAltText("mobile-preview.png")).toBeVisible();
  await page.getByRole("button", { name: /Remove attachment|移除附件/ }).click();
  await expect(page.getByAltText("mobile-preview.png")).toHaveCount(0);

  let uploadCount = 0;
  await page.route("**/api/uploads?*", async (route) => {
    uploadCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        files: [
          {
            name: "mobile-assets.zip",
            path: "/tmp/codex-gateway-uploads/upload.test/mobile-assets.zip",
            mimeType: "application/zip",
            size: 24,
            isImage: false,
          },
        ],
      }),
    });
  });
  await attachmentInput.setInputFiles({
    name: "mobile-assets.zip",
    mimeType: "application/zip",
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  });
  await expect(page.getByTestId("composer-surface")).toContainText("mobile-assets.zip");
  expect(uploadCount).toBe(1);
});

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return Object.fromEntries(Object.entries(value));
}

test("gives the Goal objective most of the mobile details dialog", async ({ page }) => {
  await openApp(page);
  const threadId = "mobile-goal-details-layout";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile Goal details" },
  });
  await installSelectedThreadGoalSubmitMock(page, { hostId: 1, threadId });

  const longObjective = "移动端目标正文需要保留足够的阅读空间。".repeat(40);
  const composer = page.getByPlaceholder("输入后续修改要求");
  await composer.fill(`/goal ${longObjective}`);
  await page.keyboard.press("Enter");
  await page.getByTestId("composer-goal-summary").click();

  const dialog = page.getByTestId("goal-details-dialog");
  const objective = dialog.getByTestId("goal-details-objective");
  const stats = dialog.getByTestId("goal-details-stats");
  const footer = dialog.getByTestId("goal-details-footer");
  await expect(dialog).toBeVisible();
  await expect(objective).toBeVisible();
  await expect(stats).toBeVisible();
  await expect(footer).toBeVisible();

  const [dialogBox, objectiveBox, statBoxes, actionBoxes] = await Promise.all([
    dialog.boundingBox(),
    objective.boundingBox(),
    stats
      .locator(":scope > div")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top)),
    Promise.all(
      ["goal-details-edit", "goal-details-stop", "goal-details-clear"].map((testId) =>
        dialog.getByTestId(testId).boundingBox(),
      ),
    ),
  ]);
  expect(dialogBox).not.toBeNull();
  expect(objectiveBox).not.toBeNull();
  expect(objectiveBox!.height).toBeGreaterThan(dialogBox!.height * 0.5);
  expect(Math.max(...statBoxes) - Math.min(...statBoxes)).toBeLessThanOrEqual(1);
  expect(actionBoxes.every((box) => box !== null)).toBe(true);
  const actionTops = actionBoxes.map((box) => box!.y);
  expect(Math.max(...actionTops) - Math.min(...actionTops)).toBeLessThanOrEqual(1);
});

test("virtualizes a large running turn in one agent timeline", async ({ page }, testInfo) => {
  await openApp(page);
  // openApp may reset persisted E2E config by navigating once. WebKit reports an HTTP request
  // cancelled by that deliberate navigation as a page-level CORS error, although it belongs to
  // the discarded document. Start diagnostics after the stable test document is ready so every
  // error produced by the large timeline itself remains a hard failure.
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const threadId = "mobile-large-running-turn";
  const commands = Array.from({ length: 351 }, (_, index) => ({
    type: "commandExecution",
    id: `large-command-${index}`,
    command: `large command ${index}`,
    aggregatedOutput: `output-${index} ${"x".repeat(4_000)}`,
    status: "completed",
    exitCode: 0,
  }));
  const fileChanges = Array.from({ length: 91 }, (_, index) => ({
    type: "fileChange",
    id: `large-file-change-${index}`,
    status: "completed",
    changes: [
      {
        path: `src/large_file_${index}.py`,
        kind: "update",
        diff: [
          `diff --git a/src/large_file_${index}.py b/src/large_file_${index}.py`,
          `--- a/src/large_file_${index}.py`,
          `+++ b/src/large_file_${index}.py`,
          "@@ -1,20 +1,20 @@",
          ...Array.from({ length: 20 }, (_, line) => `-old_value_${line} = ${line}`),
          ...Array.from({ length: 20 }, (_, line) => `+new_value_${line} = ${line + index}`),
        ].join("\n"),
      },
    ],
  }));
  const agentMessages = Array.from({ length: 97 }, (_, index) => ({
    type: "agentMessage",
    id: `large-agent-message-${index}`,
    text: `Agent progress ${index}: ${"analysis ".repeat(40)}`,
  }));
  const lifecycleProbe = {
    type: "commandExecution",
    id: "large-command-lifecycle-probe",
    command: "large command lifecycle probe",
    aggregatedOutput: `lifecycle-probe-output ${"x".repeat(4_000)}`,
    status: "completed",
    exitCode: 0,
  };
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Large mobile turn" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "large-running-turn",
            status: "inProgress",
            items: [...commands, ...agentMessages, ...fileChanges, lifecycleProbe],
          },
        ],
      },
    },
  });

  const timeline = page.getByTestId("chat-scroll-area");
  const mountedRows = timeline.locator("[data-row-key]");
  await expect(page.getByTestId("virtual-intermediate-items")).toHaveCount(0);
  await expect.poll(() => mountedRows.count()).toBeLessThan(30);

  const commandTitle = page.getByText("large command lifecycle probe", { exact: true });
  await expect(commandTitle).toHaveCount(0);
  await expect(page.getByText(/lifecycle-probe-output/)).toHaveCount(0);
  await expect(page.getByTestId("intermediate-working-status")).toHaveCount(1);

  await expect(page.getByTestId("file-change-summary").first()).toBeVisible();
  // Expanded intermediate steps keep the compact change summaries, but per-file cards and their
  // expensive syntax highlighters stay unmounted.
  await expect(page.getByRole("button", { name: /src\/large_file_/ })).toHaveCount(0);
  const mountedDiffs = page.locator(".diff-markdown .syntax-highlight");
  await expect(mountedDiffs).toHaveCount(0);

  // Move to the opposite end to verify the compacted active timeline remains virtualized.
  if (testInfo.project.name === "mobile-webkit-core-scroll") {
    await startChatTouchScrollUp(page, 1_000_000_000);
    await endChatTouchScroll(page);
    await waitForChatScrollToSettle(page);
    // The touch gesture establishes real detached intent. Once WebKit has flushed its deferred
    // measurement corrections, move to the exact boundary to test row destruction rather than
    // asserting that a synthetic one-frame gesture reproduces native momentum distance.
    await scrollChatViewportToTop(page);
  } else {
    await scrollChatViewportToTop(page);
  }
  await expect(page.getByTestId("chat-scroll-area")).toHaveAttribute("data-follow-latest", "false");
  await waitForChatScrollToSettle(page);
  await expect(page.getByText("large command lifecycle probe", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/lifecycle-probe-output/)).toHaveCount(0);
  await expect(mountedDiffs).toHaveCount(0);
  await expect.poll(() => mountedRows.count()).toBeLessThan(30);
  const resizeObserverErrors = pageErrors.filter((message) =>
    message.includes("ResizeObserver loop"),
  );
  // WebKit reports one delayed ResizeObserver delivery as a pageerror when a virtual document
  // jumps between its ends. It can report the same browser diagnostic more than once when several
  // observer batches settle together; the rows are delivered on the next frame and the browser
  // exposes no cancellation API. Chromium must remain warning-free and every distinct page error
  // still fails.
  if (testInfo.project.name === "mobile-webkit-core-scroll") {
    expect(
      resizeObserverErrors.every(
        (message) => message === "ResizeObserver loop completed with undelivered notifications.",
      ),
    ).toBe(true);
  } else {
    expect(resizeObserverErrors).toEqual([]);
  }
  expect(pageErrors.filter((message) => !message.includes("ResizeObserver loop"))).toEqual([]);
});

test("explicit history prepend keeps the mobile timeline visually stable", async ({ page }) => {
  await openApp(page);
  const threadId = "mobile-explicit-history-prepend";
  await installDeferredThreadTurnsLoadStub(page, {
    type: "thread.turns.page",
    requestId: "mobile-explicit-history-page",
    hostId: 1,
    threadId,
    history: {
      thread: { id: threadId, turns: buildTextTurns(1, 3, "mobile top-up turn", 14) },
    },
    turnsPage: { nextCursor: null, backwardsCursor: null },
  });
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile Top Up" },
    olderTurnsCursor: JSON.stringify({ turnId: "turn-004", includeAnchor: false }),
    history: {
      thread: { id: threadId, turns: buildTextTurns(4, 5, "mobile top-up turn", 14) },
    },
  });

  const latestRow = page.locator('[data-row-key*=":turn-turn-005:"]');
  await expect(latestRow).toBeVisible();
  await page.waitForTimeout(250);
  expect(await threadTurnsLoadRequests(page)).toHaveLength(0);
  await startLocatorTopTracking(latestRow);
  await requestOlderTurnsFromStore(page);
  await expect
    .poll(() => threadTurnsLoadRequests(page).then((requests) => requests.length))
    .toBe(1);
  await releaseDeferredThreadTurnsLoad(page);
  await expect.poll(() => threadTurnCount(page)).toBe(5);
  await waitForAnimationFrames(page, 8);
  const samples = await stopFrameTracking(page);
  expect(frameSpread(samples), JSON.stringify(samples)).toBeLessThanOrEqual(2);
});

test("mobile viewport resize during explicit history prepend stays bottom pinned", async ({
  page,
}) => {
  await openApp(page);
  const threadId = "mobile-resizing-history-prepend";
  await installDeferredThreadTurnsLoadStub(page, {
    type: "thread.turns.page",
    requestId: "mobile-resizing-turns-page",
    hostId: 1,
    threadId,
    history: {
      thread: { id: threadId, turns: buildTextTurns(1, 3, "mobile resize turn", 14) },
    },
    turnsPage: { nextCursor: null, backwardsCursor: null },
  });
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Mobile Resize Top Up" },
    olderTurnsCursor: JSON.stringify({ turnId: "turn-004", includeAnchor: false }),
    history: {
      thread: { id: threadId, turns: buildTextTurns(4, 5, "mobile resize turn", 14) },
    },
  });

  await page.waitForTimeout(250);
  expect(await threadTurnsLoadRequests(page)).toHaveLength(0);
  await startBottomDistanceTracking(page);
  await requestOlderTurnsFromStore(page);
  await expect
    .poll(() => threadTurnsLoadRequests(page).then((requests) => requests.length))
    .toBe(1);
  await releaseDeferredThreadTurnsLoad(page);
  await page.setViewportSize({ width: 393, height: 820 });
  await expect.poll(() => threadTurnCount(page)).toBe(5);
  await waitForAnimationFrames(page, 8);
  const samples = await stopFrameTracking(page);
  // Playwright changes Chromium's external viewport before the page receives its corresponding
  // resize/ResizeObserver delivery. Depending on browser scheduling, multiple rAF samples can
  // therefore expose the same old 35px bottom distance even though the application has not had a
  // resize callback yet. Validate the behavior we own: correction happens within a bounded prefix
  // and, once settled, never oscillates or starts another compensation cascade.
  const firstSettledFrame = samples.findIndex((distance) => distance <= 2);
  expect(firstSettledFrame, JSON.stringify(samples)).toBeGreaterThanOrEqual(0);
  expect(firstSettledFrame, JSON.stringify(samples)).toBeLessThanOrEqual(3);
  expect(
    Math.max(...samples.slice(firstSettledFrame)),
    JSON.stringify(samples),
  ).toBeLessThanOrEqual(2);
});

test("mobile touch scrolling stays anchored while Agent output streams", async ({
  page,
}, testInfo) => {
  await openApp(page);
  const threadId = "mobile-active-touch-stream";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Active Touch Stream" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          ...buildTextTurns(1, 28, "touch scroll history", 12),
          {
            id: "turn-touch-streaming",
            status: "running",
            items: [
              {
                id: "agent-touch-streaming",
                type: "agentMessage",
                status: "inProgress",
                text: "touch stream initial output",
              },
            ],
          },
        ],
      },
    },
  });

  await expect(page.getByText("touch stream initial output")).toBeVisible();
  await waitForScrollableChatViewportAtBottom(page);
  const initialGesture = await startChatTouchScrollUp(page, 180);
  expect(initialGesture.before - initialGesture.after).toBeGreaterThan(80);
  let finalAnchor: Awaited<ReturnType<typeof captureVisibleTimelineRowAnchor>> | null = null;
  for (let batch = 0; batch < 3; batch += 1) {
    if (batch > 0) {
      const continuedGesture = await continueChatTouchScrollUp(page, 180, 520 + batch * 200);
      expect(continuedGesture.before - continuedGesture.after).toBeGreaterThan(80);
    }
    finalAnchor = await captureVisibleTimelineRowAnchor(page);
    await appendAgentStreamLines(page, {
      itemId: "agent-touch-streaming",
      prefix: `touch stream batch ${batch + 1}`,
      count: 8,
    });
    await waitForAnimationFrames(page, 2);

    // Do not assert an exact anchor while the finger is down. WebKit owns the viewport during
    // this phase and TanStack deliberately queues measurement compensation so it does not cancel
    // native scrolling. The critical contract during the gesture is that streaming never takes
    // control and reattaches the reader to the bottom.
    if (testInfo.project.name !== "mobile-webkit-core-scroll") {
      await expect(page.getByTestId("chat-scroll-area")).toHaveAttribute(
        "data-follow-latest",
        "false",
      );
    }
  }
  await endChatTouchScroll(page);
  await waitForChatScrollToSettle(page);
  expect(finalAnchor).not.toBeNull();
  if (testInfo.project.name === "mobile-webkit-core-scroll") {
    await expectSyntheticWebKitTouchToRemainReadable(page);
    return;
  }
  await expect
    .poll(() => visibleTimelineRowTop(page, finalAnchor!.key))
    .toBeGreaterThanOrEqual(finalAnchor!.top - 2);
  await expect
    .poll(() => visibleTimelineRowTop(page, finalAnchor!.key))
    .toBeLessThanOrEqual(finalAnchor!.top + 2);
});

test("mobile momentum scrolling stays anchored after touchend while output streams", async ({
  page,
}, testInfo) => {
  await openApp(page);
  const threadId = "mobile-momentum-stream";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Momentum Stream" },
    status: "running",
    history: {
      thread: {
        id: threadId,
        turns: [
          ...buildTextTurns(1, 30, "momentum history", 10),
          {
            id: "turn-momentum-streaming",
            status: "running",
            items: [
              {
                id: "agent-momentum-streaming",
                type: "agentMessage",
                status: "inProgress",
                text: "momentum stream initial output",
              },
            ],
          },
        ],
      },
    },
  });

  await expect(page.getByText("momentum stream initial output")).toBeVisible();
  await waitForScrollableChatViewportAtBottom(page);
  const initialGesture = await startChatTouchScrollUp(page, 220);
  expect(initialGesture.before - initialGesture.after).toBeGreaterThan(100);
  await endChatTouchScroll(page);
  await expect(page.getByTestId("chat-scroll-area")).toHaveAttribute("data-follow-latest", "false");

  let finalAnchor: Awaited<ReturnType<typeof captureVisibleTimelineRowAnchor>> | null = null;
  for (let frame = 0; frame < 3; frame += 1) {
    const momentum = await continueChatTouchMomentumUp(page, 90);
    expect(momentum.before - momentum.after).toBeGreaterThan(40);
    // Anchor the virtual row rather than a Markdown paragraph. WebKit may place a tall paragraph
    // across the viewport boundary during native momentum even though its containing row is the
    // stable, visible unit that TanStack measures and compensates.
    finalAnchor = await captureVisibleTimelineRowAnchor(page);
    await appendAgentStreamLines(page, {
      itemId: "agent-momentum-streaming",
      prefix: `momentum stream frame ${frame + 1}`,
      count: 8,
    });
    await waitForAnimationFrames(page, 2);

    // Momentum is still browser-owned scrolling. Exact compensation is expected only once the
    // scroll-end debounce fires; forcing it per frame would hide the iOS regression by replacing
    // native behavior with a test-only scroll state machine.
    if (testInfo.project.name !== "mobile-webkit-core-scroll") {
      await expect(page.getByTestId("chat-scroll-area")).toHaveAttribute(
        "data-follow-latest",
        "false",
      );
    }
  }
  await waitForChatScrollToSettle(page);
  expect(finalAnchor).not.toBeNull();
  if (testInfo.project.name === "mobile-webkit-core-scroll") {
    // Playwright cannot synthesize a native WebKit swipe/momentum gesture. This test models the
    // browser-owned phase with scrollTop writes, but Virtual Core intentionally defers dynamic-row
    // corrections until that phase settles. A row coordinate captured before the deferred flush
    // is therefore not a valid final anchor on WebKit. Keep the user-facing contract strict: the
    // timeline must remain detached, retain visible content, and stay away from the latest edge.
    await expectSyntheticWebKitTouchToRemainReadable(page);
    return;
  }
  await expect
    .poll(() => visibleTimelineRowTop(page, finalAnchor!.key))
    .toBeGreaterThanOrEqual(finalAnchor!.top - 2);
  await expect
    .poll(() => visibleTimelineRowTop(page, finalAnchor!.key))
    .toBeLessThanOrEqual(finalAnchor!.top + 2);
});

test("opens sidebar context actions with long press on mobile", async ({
  page,
  remoteWorkspace,
}) => {
  const { remote } = remoteWorkspace;
  await openApp(page);
  const { project } = await createConfiguredHostAndProject(page, remote);
  await reloadApp(page);

  if (
    !(await page
      .getByTestId("settings-toggle")
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId("mobile-sidebar-toggle").click();
  }
  await expect(page.getByTestId(`project-button-${project.id}`)).toBeVisible();
  await longPress(page, page.getByTestId(`project-button-${project.id}`));
  await page.getByRole("menuitem", { name: /新建/ }).click();
  const threadId = await waitForSelectedThreadId(page);

  await page.getByTestId("mobile-sidebar-toggle").click();
  await page.getByTestId(`project-button-${project.id}`).click();
  await expect(page.getByTestId("project-thread-list")).toBeVisible();
  await expect(page.getByTestId("project-thread-list")).toBeVisible();
  const threadButton = page.getByTestId(`project-thread-row-${threadId}`);
  await expect(threadButton).toBeVisible({ timeout: 30_000 });

  await longPress(page, threadButton);
  await page.getByRole("menuitem", { name: /置顶/ }).click();
  await page.getByTestId("mobile-sidebar-toggle").click();
  const pinnedThread = page.getByTestId(`pinned-thread-button-${threadId}`);
  await expect(pinnedThread).toBeVisible();

  await longPress(page, pinnedThread);
  await page.getByRole("menuitem", { name: /重命名/ }).click();
  await expect(page.getByTestId("rename-thread-dialog")).toBeVisible();
  await page.getByTestId("rename-thread-input").fill("Renamed mobile thread");
  await page.getByTestId("rename-thread-submit").click();
  await expect(pinnedThread).toContainText("Renamed mobile thread");
});

test("opens and closes the subagent side panel on mobile", async ({ page }) => {
  await openApp(page);
  const threadId = "mobile-parent-thread";
  const subThreadId = "mobile-subagent-thread";
  const parentThread = gatewayThreadFixture({ id: "mobile-parent-thread", name: "Mobile Parent" });
  const subAgentThread = gatewayThreadFixture({
    id: "mobile-subagent-thread",
    name: "Mobile Parent Inherited Name",
    agentNickname: "Scout",
    agentRole: "explorer",
  });
  await seedGatewayThread(page, {
    host: { ...defaultGatewayHost(1), name: "Mobile Host" },
    threadId,
    currentThread: parentThread,
    history: {
      thread: {
        id: threadId,
        turns: [
          {
            id: "mobile-parent-turn",
            status: "running",
            items: [
              {
                id: "mobile-subagent-activity",
                type: "subAgentActivity",
                kind: "started",
                agentThreadId: subThreadId,
                agentPath: subThreadId,
              },
            ],
          },
        ],
      },
    },
    threadViews: {
      "1:mobile-subagent-thread": {
        hostId: 1,
        projectId: null,
        threadId: subThreadId,
        currentThread: subAgentThread,
        history: {
          thread: {
            id: subThreadId,
            turns: [
              {
                id: "mobile-sub-turn",
                status: "completed",
                items: [
                  {
                    id: "mobile-sub-agent",
                    type: "agentMessage",
                    phase: "final_answer",
                    text: "Mobile subagent timeline is readable.",
                  },
                ],
              },
            ],
          },
        },
        events: [],
        olderTurnsCursor: null,
        newerTurnsCursor: null,
        lastEventId: 0,
        eventEpoch: "e2e-event-epoch",
        loading: false,
        error: null,
      },
    },
  });

  await openIntermediateSteps(page);
  await page.getByTestId("open-subagent-panel").click();
  const panel = page.getByTestId("workspace-subagent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("workspace-panel-title")).toHaveText("Scout [explorer]");
  await expect(panel.getByText("Mobile subagent timeline is readable.")).toBeVisible();
  const panelBox = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(panelBox?.width).toBeGreaterThan((viewport?.width ?? 0) * 0.9);
  await page.getByRole("button", { name: "关闭标签页" }).last().click();
  await expect(panel).toBeHidden();
});

test("browses the current thread file workspace from a mobile sheet", async ({
  page,
  remoteWorkspace,
}) => {
  const { remote } = remoteWorkspace;
  await openApp(page);
  const rootPath = `/home/${remote.username}/mobile-file-project-${Date.now()}`;
  const { host, project } = await createConfiguredHostAndProject(page, remote, rootPath);
  const path = `${rootPath}/mobile-file-preview-${Date.now()}.md`;
  await execRemoteSsh(
    remote,
    `set -eu
mkdir -p ${shellQuote(rootPath)}
printf '%s\n' '# Mobile File Baseline' 'Committed before the current edit.' > ${shellQuote(path)}
git -C ${shellQuote(rootPath)} init -q
git -C ${shellQuote(rootPath)} config user.email codex-gateway-e2e@example.invalid
git -C ${shellQuote(rootPath)} config user.name 'Codex Gateway E2E'
git -C ${shellQuote(rootPath)} add -- ${shellQuote(path)}
git -C ${shellQuote(rootPath)} commit -qm 'test: establish mobile file baseline'
printf '%s\n' '# Mobile File Workspace' 'Rendered from the remote tree.' > ${shellQuote(path)}`,
  );
  const threadId = `mobile-file-thread-${Date.now()}`;
  await seedGatewayThread(page, {
    hostId: host.id,
    projectId: project.id,
    host: { ...host },
    project: { ...project },
    threadId,
    currentThread: { id: threadId, name: "Mobile Files", cwd: rootPath },
    history: { thread: { id: threadId, turns: [] } },
    status: "completed",
  });

  await page.locator('[data-testid="workspace-dock-tab"][data-panel-kind="files"]').click();
  await expect(page.getByRole("button", { name: "向右分屏" })).toHaveCount(0);
  const panel = page.getByTestId("workspace-file-panel");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "文件树", exact: true }).click();
  const tree = page.getByTestId("remote-file-tree");
  await expect(tree).toBeVisible();
  await page.getByRole("tab", { name: /变更/ }).click();
  await expect(
    page.getByTestId("git-changes-tree").locator(`[data-git-change-path=${JSON.stringify(path)}]`),
  ).toContainText("M");
  await page.getByRole("button", { name: "打开完整变更审查" }).click();
  const reviewPanel = page.getByTestId("git-review-panel");
  await expect(reviewPanel).toBeVisible();
  await expect(tree).toBeHidden();
  await expect(reviewPanel.getByTestId("git-review-diff-editor")).toContainText(
    "Mobile File Baseline",
  );
  await page
    .getByRole("region", { name: "审查变更" })
    .getByRole("button", { name: "关闭标签页" })
    .click();
  await page.getByRole("button", { name: "文件树", exact: true }).click();
  await expect(tree).toBeVisible();
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await tree.getByText(path.split("/").pop()!, { exact: true }).click();
  await expect(panel.locator(".markdown-content h1")).toHaveText("Mobile File Workspace");
  await panel.getByRole("button", { name: "源码" }).click();
  await expect(panel.getByTestId("remote-file-editor")).toContainText("Mobile File Workspace");
  await panel.getByRole("button", { name: "变更", exact: true }).click();
  await expect(panel.getByTestId("remote-file-diff-editor")).toContainText("Mobile File Baseline");
  await expect(panel.getByTestId("remote-file-diff-editor")).toContainText("Mobile File Workspace");
  const panelBox = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(panelBox?.width).toBeLessThanOrEqual(viewport?.width ?? 0);
  await expect
    .poll(() =>
      panel
        .getByTestId("file-editor-toolbar")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);

  const plainRootPath = `/home/${remote.username}/mobile-plain-project-${Date.now()}`;
  await execRemoteSsh(remote, `mkdir -p ${shellQuote(plainRootPath)}`);
  const plainProject = await authenticatedFetch(
    page,
    {
      url: "/api/projects",
      method: "POST",
      body: {
        hostId: host.id,
        name: `mobile-plain-project-${Date.now()}`,
        remotePath: plainRootPath,
      },
    },
    (value) => projectRecordSchema.parse(value),
  );
  const plainThreadId = `mobile-plain-thread-${Date.now()}`;
  await seedGatewayThread(page, {
    hostId: host.id,
    projectId: plainProject.id,
    host: { ...host },
    project: { ...plainProject },
    threadId: plainThreadId,
    currentThread: { id: plainThreadId, name: "Mobile Plain Files", cwd: plainRootPath },
    history: { thread: { id: plainThreadId, turns: [] } },
    status: "completed",
  });
  await page.locator('[data-testid="workspace-dock-tab"][data-panel-kind="files"]').click();
  await page.getByRole("button", { name: "文件树", exact: true }).click();
  await page.getByRole("tab", { name: /变更/ }).click();
  await expect(page.getByText("当前工作区不在 Git 仓库中", { exact: true })).toBeVisible();
});

async function openIntermediateSteps(page: Page) {
  const toggle = page.getByRole("button", { name: /Intermediate steps|中间过程/ }).first();
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("data-state")) !== "open") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-state", "open");
}

async function createConfiguredHostAndProject(
  page: Page,
  remote: RemoteCodexEnv,
  projectPath = remote.projectPath,
) {
  const host = await authenticatedFetch(
    page,
    {
      url: "/api/hosts",
      method: "POST",
      body: {
        name: `mobile-longpress-host-${Date.now()}`,
        sshHost: remote.host,
        username: remote.username,
        port: Number(remote.port),
        authMode: "password",
        password: remote.password,
        proxyUrl: remote.proxyUrl ?? null,
      },
    },
    (value) => hostRecordSchema.parse(value),
  );
  const project = await authenticatedFetch(
    page,
    {
      url: "/api/projects",
      method: "POST",
      body: {
        hostId: host.id,
        name: `mobile-longpress-project-${Date.now()}`,
        remotePath: projectPath,
      },
    },
    (value) => projectRecordSchema.parse(value),
  );
  return { host, project };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function longPress(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  const clientX = box!.x + box!.width / 2;
  const clientY = box!.y + box!.height / 2;
  await locator.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX,
    clientY,
  });
  await page.waitForTimeout(700);
  await locator.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX,
    clientY,
  });
}
