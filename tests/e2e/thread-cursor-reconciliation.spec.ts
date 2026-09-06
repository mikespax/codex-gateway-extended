import { expect, test } from "@playwright/test";
import type { GatewayEvent } from "../../shared/types";
import { openApp } from "./helpers/app";
import { receiveRealtimeThreadEvent, seedGatewayThread } from "./helpers/gateway-store";
import { appServerTurnFixture } from "./fixtures/app-server-turn";

test("does not reapply a replay frame at the restored snapshot cursor", async ({ page }) => {
  await openApp(page);
  const threadId = "e2e-snapshot-cursor-thread";
  const turnId = "e2e-snapshot-cursor-turn";
  const itemId = "e2e-snapshot-cursor-item";
  const eventId = 7;
  const event: GatewayEvent = {
    id: eventId,
    hostId: 1,
    threadId,
    method: "item/agentMessage/delta",
    payload: {
      id: "e2e-snapshot-cursor-event",
      method: "item/agentMessage/delta",
      params: {
        threadId,
        turnId,
        itemId,
        delta: " event",
      },
    },
    createdAt: "2026-09-02T00:00:00.000Z",
  };
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Snapshot cursor" },
    history: {
      thread: {
        id: threadId,
        turns: [
          appServerTurnFixture({
            id: turnId,
            items: [
              {
                id: itemId,
                type: "agentMessage",
                phase: "final_answer",
                status: "inProgress",
                turnId,
                text: "base event",
              },
            ],
          }),
        ],
      },
    },
    lastEventId: eventId,
    eventEpoch: "e2e-snapshot-cursor-epoch",
    status: "running",
  });

  // The restored view already includes eventId. A replay frame at the same cursor must be
  // ignored, otherwise cumulative deltas would append twice after activation/recovery.
  await receiveRealtimeThreadEvent(page, event);

  await expect
    .poll(() =>
      page.evaluate((itemId) => {
        const history = window.__codexGatewayE2e?.views.history;
        return (
          history?.thread.turns
            .flatMap((turn) => turn.items ?? [])
            .find((item) => item.id === itemId)?.text ?? null
        );
      }, itemId),
    )
    .toBe("base event");
});
