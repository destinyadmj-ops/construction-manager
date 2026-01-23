'use client';

import { useEffect } from 'react';
import { applyUiTheme, defaultUiTheme } from './ui-theme';

export default function PageThemeLoader() {
  useEffect(() => {
    // 常にライトテーマを強制適用
    applyUiTheme(defaultUiTheme());
  }, []);
  return null;
}
