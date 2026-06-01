'use client';

import { useEffect } from 'react';
import { applyUiTheme, defaultUiTheme } from './ui-theme';
import { mergeUiTheme, readLocalGlobalThemeOverride } from './page-theme';

export default function PageThemeLoader() {
  useEffect(() => {
    // ページ初期化時にグローバル設定を反映する。
    applyUiTheme(mergeUiTheme(defaultUiTheme(), readLocalGlobalThemeOverride()));
  }, []);
  return null;
}
