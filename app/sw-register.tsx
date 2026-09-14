'use client';

import { useEffect } from 'react';

function isElectronRuntime() {
  if (typeof navigator === 'undefined') return false;
  return /\bElectron\//.test(navigator.userAgent);
}

function perfLog(label: string, startedAt: number) {
  const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
  console.info(`[perf][sw-register] ${label}: ${elapsed}ms`);
}

async function unregisterServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  return registrations.length > 0;
}

async function clearMasterHubCaches() {
  if (!('caches' in window)) return;
  const keys = await window.caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('master-hub-')).map((key) => window.caches.delete(key)));
}

export default function ServiceWorkerRegister() {
  useEffect(() => {
    const effectStartedAt = performance.now();
    const enableInDev = process.env.NEXT_PUBLIC_ENABLE_SW === '1';
    if (!('serviceWorker' in navigator)) return;

    if (isElectronRuntime()) {
      // Electron desktop startup cache invalidation is owned by apps/desktop/main.cjs.
      // Avoid duplicate SW reset + reload here to reduce cold-start latency.
      perfLog('electron branch skipped (main process owns reset)', effectStartedAt);
      return;
    }

    const resetServiceWorkers = async () => {
      const resetStartedAt = performance.now();
      const hadRegistrations = await unregisterServiceWorkers().catch(() => false);
      await clearMasterHubCaches().catch(() => {
        // no-op
      });

      perfLog(`reset ran (electron=no, registrations=${hadRegistrations ? 'yes' : 'no'})`, resetStartedAt);
    };

    if (process.env.NODE_ENV !== 'production' && !enableInDev) {
      void resetServiceWorkers();
      return;
    }

    // ServiceWorker requires a secure context (https) except localhost.
    if (typeof window !== 'undefined') {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (window.location.protocol !== 'https:' && !isLocalhost) return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => registration.update().catch(() => {
        // no-op
      }))
      .catch(() => {
        // no-op: optional enhancement
      });

    perfLog('effect setup done', effectStartedAt);
  }, []);

  return null;
}
