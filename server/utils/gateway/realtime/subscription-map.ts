export type ReleaseSubscription = () => void;

export function replaceSubscription<Key>(
  subscriptions: Map<Key, ReleaseSubscription>,
  key: Key,
  subscribe: () => ReleaseSubscription,
) {
  subscriptions.get(key)?.();
  const release = subscribe();
  subscriptions.set(key, release);
  return release;
}

export function removeSubscription<Key>(subscriptions: Map<Key, ReleaseSubscription>, key: Key) {
  subscriptions.get(key)?.();
  subscriptions.delete(key);
}

export function clearSubscriptions<Key>(subscriptions: Map<Key, ReleaseSubscription>) {
  for (const release of subscriptions.values()) release();
  subscriptions.clear();
}
