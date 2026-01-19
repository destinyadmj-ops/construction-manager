'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    const enableInDev = process.env.NEXT_PUBLIC_ENABLE_SW === '1';
    if (process.env.NODE_ENV !== 'production' && !enableInDev) return;
    if (!('serviceWorker' in navigator)) return;

    // ServiceWorker requires a secure context (https) except localhost.
    if (typeof window !== 'undefined') {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (window.location.protocol !== 'https:' && !isLocalhost) return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // no-op: optional enhancement
    });
  }, []);

  return null;
}
