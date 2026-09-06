import type { GatewayEvent } from "~~/shared/types";
import type { AppServerEventParams } from "~~/shared/thread-history/app-server-event-handlers/types";

export type { AppServerEventParams };

export type GatewayEventHandler = (
  event: GatewayEvent,
  params: AppServerEventParams,
  threadId: string,
) => void;
export type GatewayEventHandlerRegistry = Record<string, GatewayEventHandler>;
