const MEBIBYTE = 1024 * 1024;
const COLLECTION_INTERVAL_MS = 5 * 60_000;
const COLLECTION_RSS_THRESHOLD = 384 * MEBIBYTE;

type GarbageCollector = () => void;

export class MemoryHousekeepingService {
  private timer: NodeJS.Timeout | null = null;
  private warnedUnavailable = false;

  start() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.collectIfNeeded(), COLLECTION_INTERVAL_MS);
    // Housekeeping must never keep a shutting-down Nitro process alive.
    this.timer.unref();
  }

  stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private collectIfNeeded() {
    const before = process.memoryUsage();
    if (before.rss < COLLECTION_RSS_THRESHOLD) return;

    const collect = exposedGarbageCollector();
    if (collect === null) {
      if (!this.warnedUnavailable) {
        console.warn(
          "[gateway-memory] periodic collection unavailable; start Node with --expose-gc",
        );
        this.warnedUnavailable = true;
      }
      return;
    }

    collect();
    const after = process.memoryUsage();
    console.info("[gateway-memory] periodic collection completed", {
      rssBeforeMiB: toMebibytes(before.rss),
      rssAfterMiB: toMebibytes(after.rss),
      heapBeforeMiB: toMebibytes(before.heapUsed),
      heapAfterMiB: toMebibytes(after.heapUsed),
    });
  }
}

function exposedGarbageCollector(): GarbageCollector | null {
  if (typeof globalThis.gc !== "function") return null;
  return () => {
    globalThis.gc?.();
  };
}

function toMebibytes(bytes: number) {
  return Math.round((bytes / MEBIBYTE) * 10) / 10;
}

export const memoryHousekeepingService = new MemoryHousekeepingService();
