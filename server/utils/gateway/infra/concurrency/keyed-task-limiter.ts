import pLimit, { type LimitFunction } from "p-limit";

/** Bounds independent task streams without retaining idle keys indefinitely. */
export class KeyedTaskLimiter {
  private readonly limits = new Map<string, LimitFunction>();

  constructor(private readonly concurrency: number) {}

  async run<Result>(
    key: string,
    task: () => Promise<Result>,
    options: { signal?: AbortSignal } = {},
  ) {
    const limit = this.limitFor(key);
    const operation = limit(async () => {
      options.signal?.throwIfAborted();
      return await task();
    });
    const cleanup = () => {
      queueMicrotask(() => {
        if (this.limits.get(key) === limit && limit.activeCount === 0 && limit.pendingCount === 0) {
          this.limits.delete(key);
        }
      });
    };
    // An aborted caller may stop awaiting while p-limit still owns the queued operation. Attach
    // cleanup to the operation itself so the key is released after that queue entry is skipped.
    void operation.then(cleanup, cleanup);
    return options.signal === undefined
      ? await operation
      : await waitForOperation(operation, options.signal);
  }

  private limitFor(key: string) {
    const existing = this.limits.get(key);
    if (existing !== undefined) return existing;
    const limit = pLimit(this.concurrency);
    this.limits.set(key, limit);
    return limit;
  }
}

function waitForOperation<Result>(operation: Promise<Result>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<Result>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(
          error instanceof Error ? error : new Error("Queued operation failed", { cause: error }),
        );
      },
    );
  });
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Queued operation was aborted", { cause: signal.reason });
}
