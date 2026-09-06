const RELOAD_MARKER = "codex-gateway:legacy-worker-retired";

async function retireLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) {
    sessionStorage.removeItem(RELOAD_MARKER);
    return;
  }

  const hadController = navigator.serviceWorker.controller !== null;
  const unregisterResults = await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );

  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  }

  if (
    hadController &&
    unregisterResults.some(Boolean) &&
    sessionStorage.getItem(RELOAD_MARKER) !== "1"
  ) {
    sessionStorage.setItem(RELOAD_MARKER, "1");
    window.location.reload();
  }
}

export default defineNuxtPlugin(() => {
  void retireLegacyServiceWorkers().catch((error: unknown) => {
    console.warn("Unable to retire a legacy Codex Gateway service worker", error);
  });
});
