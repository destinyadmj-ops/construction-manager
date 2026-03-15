'use client';

import { useEffect } from 'react';
import { applyUiTheme, defaultUiTheme } from './ui-theme';

export default function UiThemeLoader() {
  useEffect(() => {
    // 常にライトテーマを強制適用
    applyUiTheme(defaultUiTheme());
    // 'dark'クラスを強制的に除去
    document.documentElement.classList.remove('dark');
  }, []);
  return null;
}
