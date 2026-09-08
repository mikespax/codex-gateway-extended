import { readValidatedBody } from "h3";
import type { HostWithSecret } from "../../utils/gateway/infra/ssh/ssh-types";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { sidebarSummaryBatchSchema } from "../../utils/gateway/http/validation/threads";
import { summarizeSidebarBatch } from "../../utils/gateway/ai/sidebar-summarizer";
import { hostStore } from "../../utils/gateway/state/hosts";

const DEFAULT_RUNNER_NAME = "Mac";

export default defineGatewayEventHandler(async (event) => {
  const body = await readValidatedBody(event, (value) => sidebarSummaryBatchSchema.parse(value));
  const userId = event.context.auth!.user.id;
  const runnerHost = summarizerHost();
  if (runnerHost === null) {
    return { data: [], available: false };
  }

  const items = body.items.filter((item) => hostStore.get(item.hostId) !== null);
  if (items.length === 0) return { data: [], available: false };

  try {
    const data = await summarizeSidebarBatch(userId, runnerHost, items);
    return { data, available: true };
  } catch {
    // Summaries are advisory. Authentication, SSH, or model failures must never block the
    // sidebar or reveal remote command output to the browser.
    return { data: [], available: false };
  }
});

function summarizerHost(): HostWithSecret | null {
  const configuredName = process.env.CODEX_GATEWAY_SUMMARY_HOST?.trim();
  const name =
    configuredName === undefined || configuredName === "" ? DEFAULT_RUNNER_NAME : configuredName;
  const expected = name.toLocaleLowerCase();
  return (
    hostStore.listWithSecret().find((host) => host.name.trim().toLocaleLowerCase() === expected) ??
    null
  );
}
