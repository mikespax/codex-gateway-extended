export interface AdaptivePollScheduleOptions {
  minimumDelayMs: number;
  maximumDelayMs: number;
  failureDelaysMs: readonly number[];
  jitterRatio?: number;
}

/**
 * Backoff strategy for self-clocked background work.
 *
 * The caller starts its next timer only after the current operation settles. This class deliberately
 * does not own that timer or the operation: metrics keeps control of its SSH channel, while tmux
 * keeps control of subscriptions and snapshot fanout. Sharing only the cadence policy prevents the
 * two features from growing subtly different retry loops without creating a generic task framework.
 */
export class AdaptivePollSchedule {
  private failureCount = 0;

  constructor(private readonly options: AdaptivePollScheduleOptions) {
    if (options.failureDelaysMs.length === 0) {
      throw new Error("Adaptive polling requires at least one failure delay");
    }
  }

  afterSuccess(elapsedMs: number) {
    this.failureCount = 0;
    return this.withJitter(
      Math.min(
        this.options.maximumDelayMs,
        Math.max(this.options.minimumDelayMs, Math.max(0, elapsedMs)),
      ),
    );
  }

  afterFailure() {
    const index = Math.min(this.failureCount, this.options.failureDelaysMs.length - 1);
    this.failureCount += 1;
    return this.withJitter(this.options.failureDelaysMs[index]!);
  }

  private withJitter(delayMs: number) {
    const ratio = this.options.jitterRatio ?? 0.1;
    const factor = 1 - ratio + Math.random() * ratio * 2;
    return Math.round(delayMs * factor);
  }
}
