import assert from "node:assert/strict";
import test from "node:test";
import { threadImageReferences, threadImageSource } from "../../app/utils/thread-images";

void test("normalizes Codex imageView and generated-image paths", () => {
  const references = threadImageReferences({
    id: "image-1",
    type: "imageView",
    path: "/tmp/error.png",
  });

  assert.deepEqual(references, [
    {
      id: "image-1-0",
      path: "/tmp/error.png",
      url: "",
      detail: null,
      label: "Image",
    },
  ]);
  const firstReference = references[0];
  assert.ok(firstReference);
  assert.equal(
    threadImageSource(firstReference, 7),
    "/api/remote/images?hostId=7&path=%2Ftmp%2Ferror.png",
  );
  assert.deepEqual(
    threadImageReferences({
      id: "image-2",
      type: "imageGeneration",
      savedPath: "/tmp/generated.webp",
    })[0],
    {
      id: "image-2-0",
      path: "/tmp/generated.webp",
      url: "",
      detail: null,
      label: "Generated image",
    },
  );
});

void test("normalizes inline user images and ignores unsupported sources", () => {
  const references = threadImageReferences({
    id: "user-1",
    type: "userMessage",
    content: [
      { type: "text", text: "Please inspect this" },
      { type: "image", url: "data:image/png;base64,abc", detail: "high" },
      { type: "image", url: "javascript:alert(1)" },
    ],
  });

  assert.equal(references.length, 2);
  const firstReference = references[0];
  const secondReference = references[1];
  assert.ok(firstReference);
  assert.ok(secondReference);
  assert.equal(threadImageSource(firstReference, 7), "data:image/png;base64,abc");
  assert.equal(threadImageSource(secondReference, 7), "");
});
