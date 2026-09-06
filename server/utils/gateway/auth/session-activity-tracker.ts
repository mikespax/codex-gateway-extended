import { gatewayDatabase } from "../storage/database";

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;
const MAX_TRACKED_SESSIONS = 10_000;

/**
 * Authentication still validates SQLite on every request. Only the ancillary last_seen_at write
 * is coalesced so high-frequency file, terminal and realtime traffic does not create a write
 * transaction per request.
 */
export class SessionActivityTracker {
  private readonly lastWrittenAt = new Map<string, number>();

  touch(tokenHash: string) {
    const now = Date.now();
    const previous = this.lastWrittenAt.get(tokenHash);
    if (previous !== undefined && now - previous < LAST_SEEN_WRITE_INTERVAL_MS) return;

    try {
      const result = gatewayDatabase()
        .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
        .run(new Date(now).toISOString(), tokenHash);
      if (result.changes > 0) {
        this.lastWrittenAt.set(tokenHash, now);
        this.prune(now);
      } else {
        this.lastWrittenAt.delete(tokenHash);
      }
    } catch (error) {
      // last_seen_at is observability metadata, not an authentication decision. A failed write
      // must not reject a session which already passed the authoritative user/expiry query.
      this.lastWrittenAt.delete(tokenHash);
      console.warn("[gateway-auth] failed to record session activity", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  forget(tokenHash: string) {
    this.lastWrittenAt.delete(tokenHash);
  }

  private prune(now: number) {
    if (this.lastWrittenAt.size <= MAX_TRACKED_SESSIONS) return;
    for (const [tokenHash, writtenAt] of this.lastWrittenAt) {
      if (now - writtenAt >= LAST_SEEN_WRITE_INTERVAL_MS) this.lastWrittenAt.delete(tokenHash);
      if (this.lastWrittenAt.size <= MAX_TRACKED_SESSIONS) return;
    }
    this.lastWrittenAt.delete(this.lastWrittenAt.keys().next().value!);
  }
}

export const sessionActivityTracker = new SessionActivityTracker();
