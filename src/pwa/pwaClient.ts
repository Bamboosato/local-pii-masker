export function canUsePwaServiceWorker(): boolean {
  return (
    import.meta.env.PROD &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator
  );
}

export function registerPwaServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!canUsePwaServiceWorker()) {
    return Promise.reject(new Error("Service Worker is not supported."));
  }

  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}
