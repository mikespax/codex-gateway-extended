import type { HostRecord, ThreadGoalStatus } from "~~/shared/types";
import type { ControllerRegistry } from "./controller-registry";
import {
  parseThreadGoalClearResponse,
  parseThreadGoalGetResponse,
  parseThreadGoalSetResponse,
} from "~~/shared/runtime/app-server";

export class ThreadGoalService {
  constructor(private readonly registry: ControllerRegistry) {}

  async setThreadGoal(
    host: HostRecord,
    threadId: string,
    input: {
      objective?: string | null;
      status?: ThreadGoalStatus | null;
      tokenBudget?: number | null;
    },
  ) {
    const params: Record<string, unknown> = { threadId };
    if ("objective" in input) params.objective = input.objective;
    if ("status" in input) params.status = input.status;
    if ("tokenBudget" in input) params.tokenBudget = input.tokenBudget;
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(() =>
        controller.client.request("thread/goal/set", params, 120_000, parseThreadGoalSetResponse),
      ),
    );
  }

  async getThreadGoal(host: HostRecord, threadId: string) {
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(() =>
        controller.client.request(
          "thread/goal/get",
          { threadId },
          120_000,
          parseThreadGoalGetResponse,
        ),
      ),
    );
  }

  async clearThreadGoal(host: HostRecord, threadId: string) {
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(() =>
        controller.client.request(
          "thread/goal/clear",
          { threadId },
          120_000,
          parseThreadGoalClearResponse,
        ),
      ),
    );
  }
}
