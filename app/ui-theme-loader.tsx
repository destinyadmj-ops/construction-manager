'use client';

import { useEffect } from 'react';
import { applyUiTheme, defaultUiTheme } from './ui-theme';
import { mergeUiTheme, readLocalGlobalThemeOverride } from './page-theme';

export default function UiThemeLoader() {
  useEffect(() => {
    // ローカルに残っているグローバル設定を先に反映し、
    // 後続の controller でサーバ同期済み設定へ上書きされる前提にする。
    applyUiTheme(mergeUiTheme(defaultUiTheme(), readLocalGlobalThemeOverride()));
    // 'dark'クラスを強制的に除去
    document.documentElement.classList.remove('dark');
  }, []);
  return null;
}
