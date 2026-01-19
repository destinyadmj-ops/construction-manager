'use client';

import { useEffect } from 'react';
import {
  applyUiTheme,
  defaultUiTheme,
  normalizeUiTheme,
  readLocalUiTheme,
  UI_THEME_SETTING_KEY,
  writeLocalUiTheme,
} from './ui-theme';

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export default function UiThemeLoader() {
  useEffect(() => {
    let cancelled = false;

    // Safe default (keeps existing UX)
    applyUiTheme(defaultUiTheme());

    const applyFromLocal = (userId: string | null) => {
      const t = readLocalUiTheme(userId);
      applyUiTheme(t);
      return t;
    };

    void (async () => {
      // anonymous/local-first
      applyFromLocal(null);

      try {
        const meRes = await fetch('/api/auth/me');
        const meJson = (await meRes.json().catch(() => null)) as unknown;
        const meObj = asObject(meJson);
        const userObj = asObject(meObj?.user);
        const userId = typeof userObj?.id === 'string' ? (userObj.id as string) : null;

        if (cancelled) return;

        // user-local cache next
        applyFromLocal(userId);

        if (!userId) return;

        const r = await fetch(`/api/ui-settings?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(UI_THEME_SETTING_KEY)}`);
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        if (!r.ok || obj?.ok !== true) return;

        const theme = normalizeUiTheme(obj.value);
        if (cancelled) return;
        applyUiTheme(theme);
        writeLocalUiTheme(userId, theme);
      } catch {
        // ignore
      }
    })();

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (!e.key.startsWith('masterHub.ui:uiTheme:')) return;
      try {
        const parsed = e.newValue ? (JSON.parse(e.newValue) as unknown) : null;
        applyUiTheme(normalizeUiTheme(parsed));
      } catch {
        // ignore
      }
    };

    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return null;
}
