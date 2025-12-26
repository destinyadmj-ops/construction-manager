'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';

function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

function isStandalonePwa() {
  if (typeof window === 'undefined') return false;
  const dm = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return dm || iosStandalone;
}

export default function PwaBackGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const routeKey = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!isStandalonePwa()) return;
    if (!isAndroid()) return;

    // Add a sentinel entry so hardware back doesn't immediately close the app.
    // We only actively guard when the app thinks it has no in-app back stack.
    try {
      window.history.pushState({ masterHubGuard: true }, '', window.location.href);
    } catch {
      // ignore
    }

    const onPopState = () => {
      try {
        const idxRaw = window.sessionStorage.getItem('masterHub.navIndex');
        const idx = Math.max(0, Number(idxRaw ?? '0') || 0);
        if (idx > 0) return; // allow normal in-app back

        // When we're at the start of the in-app stack, keep the app open.
        window.history.pushState({ masterHubGuard: true }, '', window.location.href);

        // If the user is not already on the Week home, route there.
        const sp = new URLSearchParams(window.location.search);
        const mode = sp.get('mode');
        const atWeekHome = window.location.pathname === '/' && (!mode || mode === 'week');
        if (!atWeekHome) {
          router.replace('/?mode=week');
        }
      } catch {
        // If anything goes wrong, fail open (no hard block).
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [router]);

  return null;
}
