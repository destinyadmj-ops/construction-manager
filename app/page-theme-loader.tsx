'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { applyUiTheme, normalizeUiTheme, readLocalUiTheme } from './ui-theme';
import {
  mergeUiTheme,
  normalizePageThemeOverrides,
  pageThemeOverrideDbKey,
  pageThemeOverrideLocalKey,
  readLocalPageThemeOverride,
  writeLocalPageThemeOverride,
} from './page-theme';

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export default function PageThemeLoader() {
  const pathname = usePathname() || '/';
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applyCurrent = (userId: string | null) => {
      const base = readLocalUiTheme(userId);
      const override = readLocalPageThemeOverride(userId, pathname);
      applyUiTheme(mergeUiTheme(base, override));
    };

    // always apply local override first (fast)
    applyCurrent(userIdRef.current);

    void (async () => {
      try {
        const meRes = await fetch('/api/auth/me');
        const meJson = (await meRes.json().catch(() => null)) as unknown;
        const meObj = asObject(meJson);
        const userObj = asObject(meObj?.user);
        const userId = typeof userObj?.id === 'string' ? (userObj.id as string) : null;
        userIdRef.current = userId;

        if (cancelled) return;

        // apply user-local override
        applyCurrent(userId);

        if (!userId) return;

        const key = pageThemeOverrideDbKey(pathname);
        const r = await fetch(`/api/ui-settings?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(key)}`);
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        if (!r.ok || obj?.ok !== true) return;

        const next = normalizePageThemeOverrides(obj.value);
        if (cancelled) return;

        writeLocalPageThemeOverride(userId, pathname, next);
        applyCurrent(userId);
      } catch {
        // ignore
      }
    })();

    const onStorage = (e: StorageEvent) => {
      const userId = userIdRef.current;
      if (!e.key) return;
      const localKey = pageThemeOverrideLocalKey(userId, pathname);
      if (e.key === localKey) {
        applyCurrent(userId);
        return;
      }
      // if base theme changed, re-merge
      if (e.key.startsWith('masterHub.ui:uiTheme:')) {
        try {
          const parsed = e.newValue ? (JSON.parse(e.newValue) as unknown) : null;
          const base = normalizeUiTheme(parsed);
          const override = readLocalPageThemeOverride(userId, pathname);
          applyUiTheme(mergeUiTheme(base, override));
        } catch {
          // ignore
        }
      }
    };

    const onUpdated = () => {
      applyCurrent(userIdRef.current);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('masterHub:pageThemeOverrideUpdated', onUpdated as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('masterHub:pageThemeOverrideUpdated', onUpdated as EventListener);
    };
  }, [pathname]);

  return null;
}
