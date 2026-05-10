'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

function isLikelyMobileClient() {
  const userAgent = navigator.userAgent ?? '';
  if (/android|iphone|ipad|ipod|mobile/i.test(userAgent)) return true;

  const isNarrow = window.matchMedia('(max-width: 900px)').matches;
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  return isNarrow && (isCoarse || touchPoints > 1);
}

export default function HomeMobileRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isLikelyMobileClient()) return;

    const next = new URLSearchParams(searchParams.toString());
    next.delete('mode');
    const query = next.toString();
    router.replace(query ? `/mobile/week-hub?${query}` : '/mobile/week-hub', { scroll: false });
  }, [router, searchParams]);

  return null;
}