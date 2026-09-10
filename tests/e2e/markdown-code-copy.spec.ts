import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import { seedGatewayThread } from "./helpers/gateway-store";
import { appServerTurnFixture } from "./fixtures/app-server-turn";

test("copying highlighted code preserves line breaks", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Reflect.set(window, "__copiedMarkdownCode", value);
        },
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string) => {
        if (command === "copy" && document.activeElement instanceof HTMLTextAreaElement) {
          Reflect.set(window, "__copiedMarkdownCode", document.activeElement.value);
        }
        return true;
      },
    });
  });
  await openApp(page);

  const threadId = "e2e-markdown-code-copy";
  const codeSnippet = "hostname\nwhoami\nscutil --get LocalHostName";
  await seedGatewayThread(page, {
    projectId: 1,
    threadId,
    currentThread: { id: threadId, name: "Markdown code copy" },
    history: {
      thread: {
        id: threadId,
        turns: [
          appServerTurnFixture({
            id: "turn-markdown-code-copy",
            status: "completed",
            items: [
              {
                id: "agent-markdown-code-copy",
                type: "agentMessage",
                phase: "final_answer",
                text: ["```shell", codeSnippet, "```"].join("\n"),
              },
            ],
          }),
        ],
      },
    },
    status: "completed",
  });

  const copyButton = page.getByTestId("copy-markdown-code-button");
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __copiedMarkdownCode?: string }).__copiedMarkdownCode,
      ),
    )
    .toBe(`${codeSnippet}\n`);
});
