import type { Locator, Page } from "@playwright/test";
import type { RealtimeServerMessage, ThreadHistoryState } from "../../../shared/types";
import {
  installRealtimeThreadTurnsLoadRoute,
  realtimeThreadTurnsLoadRequests,
  releaseRealtimeThreadTurnsLoadRoute,
} from "./realtime-route";

interface FrameTracker {
  animationFrameId: number | undefined;
  samples: number[];
  timeoutId: number | undefined;
}

declare global {
  interface Window {
    __codexGatewayFrameTracker?: FrameTracker;
  }
}

export function buildTextTurns(start: number, end: number, prefix: string, lineCount = 1) {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const number = start + index;
    const label = String(number).padStart(3, "0");
    return {
      id: `turn-${label}`,
      status: "completed",
      items: [
        {
          id: `agent-${label}`,
          type: "agentMessage",
          phase: "final_answer",
          status: "completed",
          text:
            lineCount === 1
              ? `${prefix} ${label}`
              : [
                  `${prefix} ${label}`,
                  ...Array.from(
                    { length: lineCount - 1 },
                    (_, lineIndex) => `${prefix} ${label} detail ${lineIndex + 1}`,
                  ),
                ].join("\n"),
        },
      ],
    };
  });
}

export async function threadTurnCount(page: Page) {
  return await page.evaluate(() => {
    const views = window.__codexGatewayE2e?.views;
    if (!views) throw new Error("Unable to locate gateway thread-view Pinia store");
    return views.history?.thread?.turns?.length ?? 0;
  });
}

export async function installDeferredThreadTurnsLoadStub(
  page: Page,
  response: Omit<Extract<RealtimeServerMessage, { type: "thread.turns.page" }>, "history"> & {
    history: ThreadHistoryState;
  },
) {
  installRealtimeThreadTurnsLoadRoute(page, response, true);
}

export async function releaseDeferredThreadTurnsLoad(page: Page) {
  releaseRealtimeThreadTurnsLoadRoute(page);
}

export async function threadTurnsLoadRequests(page: Page) {
  return realtimeThreadTurnsLoadRequests(page);
}

export async function requestOlderTurnsFromStore(page: Page) {
  await page.evaluate(() => {
    const turns = window.__codexGatewayE2e?.turns;
    if (!turns) throw new Error("Unable to locate gateway thread-turns Pinia store");
    void turns.loadOlderTurns();
  });
}

export async function startElementTopTracking(page: Page, text: string) {
  await startLocatorTopTracking(page.getByText(text, { exact: true }));
}

export async function startLocatorTopTracking(locator: Locator) {
  await locator.evaluate((element) => {
    const samples: number[] = [element.getBoundingClientRect().top];
    const tracker: FrameTracker = {
      animationFrameId: undefined,
      samples,
      timeoutId: undefined,
    };
    const track = () => {
      tracker.animationFrameId = requestAnimationFrame(() => {
        tracker.timeoutId = window.setTimeout(() => {
          samples.push(element.getBoundingClientRect().top);
          track();
        }, 0);
      });
    };
    window.__codexGatewayFrameTracker = tracker;
    tracker.animationFrameId = requestAnimationFrame(track);
  });
}

export async function startBottomDistanceTracking(page: Page) {
  await page.getByTestId("chat-scroll-area").evaluate((root) => {
    const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) throw new Error("Missing chat viewport");
    const distance = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const samples: number[] = [distance()];
    const tracker: FrameTracker = {
      animationFrameId: undefined,
      samples,
      timeoutId: undefined,
    };
    const track = () => {
      tracker.animationFrameId = requestAnimationFrame(() => {
        tracker.timeoutId = window.setTimeout(() => {
          samples.push(distance());
          track();
        }, 0);
      });
    };
    window.__codexGatewayFrameTracker = tracker;
    tracker.animationFrameId = requestAnimationFrame(track);
  });
}

export async function stopFrameTracking(page: Page) {
  return await page.evaluate(() => {
    const tracker = window.__codexGatewayFrameTracker;
    if (tracker?.animationFrameId !== undefined) cancelAnimationFrame(tracker.animationFrameId);
    if (tracker?.timeoutId !== undefined) clearTimeout(tracker.timeoutId);
    window.__codexGatewayFrameTracker = undefined;
    return tracker?.samples ?? [];
  });
}

export async function waitForAnimationFrames(page: Page, count: number) {
  await page.evaluate(
    (frameCount) =>
      new Promise<void>((resolve) => {
        const wait = (remaining: number) => {
          if (remaining <= 0) {
            resolve();
            return;
          }
          requestAnimationFrame(() => wait(remaining - 1));
        };
        wait(frameCount);
      }),
    count,
  );
}

export function frameSpread(samples: number[]) {
  return Math.max(...samples) - Math.min(...samples);
}
