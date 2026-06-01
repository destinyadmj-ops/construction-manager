'use client';

import { useEffect } from 'react';
import { applyUiTheme, defaultUiTheme } from './ui-theme';
import { mergeUiTheme, normalizePageThemeOverrides, readLocalGlobalThemeOverride, writeLocalGlobalThemeOverride, globalThemeOverrideDbKey } from './page-theme';

const GLOBAL_UI_SETTINGS_USER_ID = '__MASTER_HUB_GLOBAL__';

export default function PageThemeLoader() {
  useEffect(() => {
    let cancelled = false;

    const applyTheme = (raw: unknown) => {
      const normalized = normalizePageThemeOverrides(raw);
      const next = mergeUiTheme(defaultUiTheme(), normalized);
      if (cancelled) return;
      writeLocalGlobalThemeOverride(normalized);
      applyUiTheme(next);
    };

    applyTheme(readLocalGlobalThemeOverride());

    void (async () => {
      try {
        const res = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(GLOBAL_UI_SETTINGS_USER_ID)}&key=${encodeURIComponent(
            globalThemeOverrideDbKey(),
          )}`,
          { cache: 'no-store' },
        );
        const json = (await res.json().catch(() => null)) as unknown;
        if (!res.ok || !json || typeof json !== 'object' || (json as { ok?: unknown }).ok !== true) return;
        applyTheme((json as { value?: unknown }).value);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
