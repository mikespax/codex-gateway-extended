import type { RealtimeClientMessage, RealtimeServerMessage } from "../types";
import { realtimeClientMessageSchema } from "./realtime/client-message-schema";
import { realtimeServerMessageSchema } from "./realtime/server-message-schema";

export function parseRealtimeClientMessage(value: unknown): RealtimeClientMessage {
  return realtimeClientMessageSchema.parse(value);
}

export function parseRealtimeServerMessage(value: unknown): RealtimeServerMessage {
  return realtimeServerMessageSchema.parse(value);
}
