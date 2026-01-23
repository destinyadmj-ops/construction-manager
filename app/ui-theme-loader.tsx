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
    // 常にライトテーマを強制適用
    applyUiTheme(defaultUiTheme());
    // 'dark'クラスを強制的に除去
    document.documentElement.classList.remove('dark');
  }, []);
  return null;
}
