import { EventEmitter } from "node:events";

export interface BrowserFramePolicyEvent {
  type: "frame-policy";
  userId: number;
  sessionId: string;
  policy: "x-frame-options" | "content-security-policy";
  value: string;
}

export interface BrowserResourceFailureEvent {
  type: "resource-failed";
  userId: number;
  sessionId: string;
  failure: {
    statusCode: number;
    method: string;
    path: string;
    destination: string;
    occurredAt: string;
  };
}

export type BrowserPreviewEvent = BrowserFramePolicyEvent | BrowserResourceFailureEvent;

const events = new EventEmitter();

export const browserPreviewEvents = {
  publish(event: BrowserPreviewEvent) {
    events.emit("browser-preview", event);
  },
  subscribe(userId: number, listener: (event: BrowserPreviewEvent) => void) {
    const scoped = (event: BrowserPreviewEvent) => {
      if (event.userId === userId) listener(event);
    };
    events.on("browser-preview", scoped);
    return () => events.off("browser-preview", scoped);
  },
};
