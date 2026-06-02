'use client';

import { useEffect } from 'react';

const ELECTRON_SW_RESET_KEY = 'mh-electron-sw-reset';

function isElectronRuntime() {
  if (typeof navigator === 'undefined') return false;
  return /\bElectron\//.test(navigator.userAgent);
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
    const enableInDev = process.env.NEXT_PUBLIC_ENABLE_SW === '1';
    if (!('serviceWorker' in navigator)) return;

    const resetServiceWorkers = async () => {
      const hadController = Boolean(navigator.serviceWorker.controller);
      const hadRegistrations = await unregisterServiceWorkers().catch(() => false);
      await clearMasterHubCaches().catch(() => {
        // no-op
      });

      if (!isElectronRuntime()) return;
      if (!hadController && !hadRegistrations) {
        window.sessionStorage.removeItem(ELECTRON_SW_RESET_KEY);
        return;
      }

      if (window.sessionStorage.getItem(ELECTRON_SW_RESET_KEY) === '1') {
        window.sessionStorage.removeItem(ELECTRON_SW_RESET_KEY);
        return;
      }

      window.sessionStorage.setItem(ELECTRON_SW_RESET_KEY, '1');
      window.location.reload();
    };

    if (isElectronRuntime()) {
      void resetServiceWorkers();
      return;
    }

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
  }, []);

  return null;
}
