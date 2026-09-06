import { pinnedKey } from "../thread-utils/identity";

type ReleaseThreadSubscription = () => void;

class ThreadViewSubscriptionLeaseRegistry {
  private readonly releases = new Map<string, ReleaseThreadSubscription>();

  retain(hostId: number, threadId: string, release: ReleaseThreadSubscription) {
    const key = pinnedKey(hostId, threadId);
    if (!this.releases.has(key)) this.releases.set(key, release);
  }

  release(hostId: number, threadId: string) {
    const key = pinnedKey(hostId, threadId);
    const release = this.releases.get(key);
    if (!release) return false;
    this.releases.delete(key);
    release();
    return true;
  }

  clearWithoutRelease() {
    // Session reset already closes the transport. Calling every release callback here would only
    // enqueue unsubscribe messages onto the replacement session.
    this.releases.clear();
  }
}

// Thread-view retention is the sole owner of realtime subscription lifetime. Realtime records how
// to release a subscription but does not maintain a second cache/capacity policy.
export const threadViewSubscriptionLeases = new ThreadViewSubscriptionLeaseRegistry();
