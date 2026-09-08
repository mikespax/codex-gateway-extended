import assert from "node:assert/strict";
import test from "node:test";
import type { ThreadTimelineItem } from "../../shared/types";
import { shouldShowInlineImages } from "../../app/components/thread/timeline-rows";

void test("hides recorded images unless a turn is waiting for user input", () => {
  const image: ThreadTimelineItem = {
    id: "image-1",
    type: "imageView",
    path: "/tmp/error.png",
  };
  assert.equal(shouldShowInlineImages("intermediate", [image]), false);
  assert.equal(
    shouldShowInlineImages("intermediate", [
      image,
      { id: "request-1", type: "requestUserInput", requestId: "request-1" },
    ]),
    true,
  );
  assert.equal(
    shouldShowInlineImages("intermediate", [
      image,
      { id: "approval-1", type: "commandExecution", pendingApproval: { requestId: "approval-1" } },
    ]),
    true,
  );
});

void test("always shows images attached to user messages", () => {
  const userImage: ThreadTimelineItem = {
    id: "user-1",
    type: "userMessage",
    content: [{ type: "image", url: "data:image/png;base64,abc" }],
  };
  assert.equal(shouldShowInlineImages("user", [userImage]), true);
});
