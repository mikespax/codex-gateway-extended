import { randomUUID } from "node:crypto";
import { z } from "zod";
import { expect, test } from "./fixtures/remote-workspace";
import { openApp } from "./helpers/app";
import { execRemoteSsh } from "./helpers/remote-codex";
import { remoteTurnFileInputs } from "../../app/composables/composer/attachment-turn-input";
import { realtimeClientMessageSchema } from "../../shared/runtime/realtime/client-message-schema";

const uploadedFilesSchema = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      mimeType: z.string().nullable(),
      size: z.number().int().nonnegative(),
      isImage: z.boolean(),
    }),
  ),
});

test("strips local attachment metadata before validating a turn payload", () => {
  const files = remoteTurnFileInputs([
    {
      id: "composer-only-id",
      name: "review.zip",
      path: "/tmp/codex-gateway-uploads/upload.test/review.zip",
      mimeType: "application/zip",
      size: 4,
      isImage: false,
    },
    {
      id: "second-composer-only-id",
      name: "instructions.md",
      path: "/tmp/codex-gateway-uploads/upload.test/instructions.md",
      mimeType: "text/markdown",
      size: 12,
      isImage: false,
    },
  ]);

  expect(files).toEqual([
    {
      name: "review.zip",
      path: "/tmp/codex-gateway-uploads/upload.test/review.zip",
      mimeType: "application/zip",
      size: 4,
      isImage: false,
    },
    {
      name: "instructions.md",
      path: "/tmp/codex-gateway-uploads/upload.test/instructions.md",
      mimeType: "text/markdown",
      size: 12,
      isImage: false,
    },
  ]);
  expect(
    realtimeClientMessageSchema.safeParse({
      type: "turn.start",
      requestId: "payload-validation-request",
      hostId: 1,
      threadId: "payload-validation-thread",
      projectId: 1,
      text: "Review the attached archive",
      clientUserMessageId: "turn-payload-validation",
      cwd: "/tmp/project",
      model: null,
      effort: null,
      approvalPolicy: null,
      files,
    }).success,
  ).toBe(true);
});

test("accepts an attachment from an already-open legacy browser tab without retaining its id", () => {
  const parsed = realtimeClientMessageSchema.parse({
    type: "turn.start",
    requestId: "legacy-payload-validation-request",
    hostId: 1,
    threadId: "legacy-payload-validation-thread",
    projectId: 1,
    text: "Review the attached archive",
    clientUserMessageId: "legacy-turn-payload-validation",
    cwd: "/tmp/project",
    model: null,
    effort: null,
    approvalPolicy: null,
    files: [
      {
        id: "legacy-composer-only-id",
        name: "review.zip",
        path: "/tmp/codex-gateway-uploads/upload.test/review.zip",
        mimeType: "application/zip",
        size: 4,
        isImage: false,
      },
    ],
  });

  expect(parsed.type).toBe("turn.start");
  if (parsed.type !== "turn.start") throw new Error("Expected turn.start payload");
  const parsedFile = parsed.files?.[0];
  expect(parsed.files).toEqual([
    {
      name: "review.zip",
      path: "/tmp/codex-gateway-uploads/upload.test/review.zip",
      mimeType: "application/zip",
      size: 4,
      isImage: false,
    },
  ]);
  if (parsedFile === undefined) throw new Error("Expected a parsed attachment");

  const unknownField = realtimeClientMessageSchema.safeParse({
    ...parsed,
    files: [{ ...parsedFile, unexpected: true }],
  });
  expect(unknownField.success).toBe(false);
});

test("uploads a ZIP attachment to the selected remote host", async ({ page, remoteWorkspace }) => {
  await openApp(page);
  const { host } = await remoteWorkspace.provision({
    hostName: `upload-host-${Date.now()}`,
  });
  const { remote } = remoteWorkspace;
  const fileName = `gateway-upload-${randomUUID()}.zip`;
  const response = await page.evaluate(
    async ({ hostId, fileName }) => {
      const token = localStorage.getItem("codex-gateway-auth-token");
      if (token === null || token === "") throw new Error("Missing auth token");
      const form = new FormData();
      form.append(
        "files",
        new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], fileName, {
          type: "application/zip",
        }),
      );
      const result = await fetch(`/api/uploads?hostId=${hostId}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      return { status: result.status, body: await result.text() };
    },
    { hostId: host.id, fileName },
  );

  expect(response.status, response.body).toBe(200);
  const uploaded = uploadedFilesSchema.parse(JSON.parse(response.body));
  expect(uploaded.files).toEqual([
    expect.objectContaining({
      name: fileName,
      mimeType: "application/zip",
      size: 4,
      isImage: false,
    }),
  ]);
  const remotePath = uploaded.files[0]!.path;
  expect(remotePath).toMatch(
    /^\/tmp\/codex-gateway-uploads\/upload\.[A-Za-z0-9]+\/[0-9a-f-]+\.zip$/,
  );
  const remoteDirectory = remotePath.slice(0, remotePath.lastIndexOf("/"));

  try {
    const inspection = await execRemoteSsh(
      remote,
      `wc -c < ${shellQuote(remotePath)} && od -An -tx1 -N4 ${shellQuote(remotePath)} | tr -d ' \\n'`,
    );
    expect(inspection.stdout.trim().split(/\s+/)).toEqual(["4", "504b0304"]);
  } finally {
    await execRemoteSsh(remote, `rm -rf -- ${shellQuote(remoteDirectory)}`);
  }
});

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
