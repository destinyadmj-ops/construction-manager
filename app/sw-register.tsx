'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    const enableInDev = process.env.NEXT_PUBLIC_ENABLE_SW === '1';
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production' && !enableInDev) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => {
          // no-op
        });

      if ('caches' in window) {
        window.caches
          .keys()
          .then((keys) => Promise.all(keys.filter((key) => key.startsWith('master-hub-')).map((key) => window.caches.delete(key))))
          .catch(() => {
            // no-op
          });
      }

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
