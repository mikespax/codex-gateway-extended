import { EventEmitter } from "@posva/event-emitter";
import type { ThreadRuntimeStatusUpdate } from "~~/shared/types";

type ThreadRuntimeStatusEvents = Record<PropertyKey, unknown> & {
  updated: ThreadRuntimeStatusUpdate;
};

/**
 * User-scoped fan-out for sidebar runtime state.
 *
 * Full app-server events remain thread-scoped because broadcasting token, diff, and command
 * output to every browser would waste memory and bandwidth. This hub retains only concurrently
 * running identities so a newly connected browser can restore its sidebar without subscribing
 * to every thread. Terminal updates are emitted once and immediately removed from the snapshot.
 */
class ThreadRuntimeStatusHub {
  private readonly emitters = new Map<number, EventEmitter<ThreadRuntimeStatusEvents>>();
  private readonly runningByUser = new Map<number, Map<string, ThreadRuntimeStatusUpdate>>();

  publish(userId: number, update: ThreadRuntimeStatusUpdate) {
    const running = this.runningByUser.get(userId) ?? new Map<string, ThreadRuntimeStatusUpdate>();
    const key = statusKey(update.hostId, update.threadId);
    if (update.status === "running") {
      running.set(key, update);
      this.runningByUser.set(userId, running);
    } else {
      running.delete(key);
      if (running.size === 0) this.runningByUser.delete(userId);
    }
    this.emitters.get(userId)?.emit("updated", update);
  }

  subscribe(userId: number, listener: (update: ThreadRuntimeStatusUpdate) => void) {
    let emitter = this.emitters.get(userId);
    if (emitter === undefined) {
      emitter = new EventEmitter<ThreadRuntimeStatusEvents>();
      this.emitters.set(userId, emitter);
    }
    const unsubscribe = emitter.on("updated", listener);
    return () => {
      unsubscribe();
      if (emitter.all.size === 0) this.emitters.delete(userId);
    };
  }

  snapshot(userId: number) {
    return [...(this.runningByUser.get(userId)?.values() ?? [])];
  }

  deleteHost(userId: number, hostId: number) {
    const running = this.runningByUser.get(userId);
    if (running === undefined) return;
    for (const [key, update] of running) {
      if (update.hostId === hostId) running.delete(key);
    }
    if (running.size === 0) this.runningByUser.delete(userId);
  }
}

function statusKey(hostId: number, threadId: string) {
  return `${hostId}:${threadId}`;
}

export const threadRuntimeStatusHub = new ThreadRuntimeStatusHub();
