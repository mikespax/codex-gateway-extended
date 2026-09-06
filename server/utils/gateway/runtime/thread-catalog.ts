import type { AppServerThread, HostRecord } from "~~/shared/types";
import type { ControllerRegistry } from "./controller-registry";
import { z } from "zod";
import { appServerThreadSchema } from "~~/shared/runtime/app-server";

const threadListPageSchema = z
  .object({
    data: z.array(appServerThreadSchema),
    nextCursor: z.string().nullable().optional(),
  })
  .loose();

export interface ThreadListPage {
  data: AppServerThread[];
  nextCursor?: string | null;
  [key: string]: unknown;
}

export class ThreadCatalogService {
  constructor(private readonly registry: ControllerRegistry) {}

  async listThreads(host: HostRecord, params: Record<string, unknown>): Promise<ThreadListPage> {
    const client = await this.registry.getHostClient(host);
    const page = threadListPageSchema.parse(await client.request("thread/list", params));
    return page;
  }

  async listModels(host: HostRecord, params: Record<string, unknown>) {
    const client = await this.registry.getHostClient(host);
    return client.request("model/list", params);
  }
}
