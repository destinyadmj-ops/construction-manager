'use client';

import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales, CommandType } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreJaJP from '@univerjs/preset-sheets-core/locales/ja-JP';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { WorkSlipBookSnapshot } from '@/shared/work-slip-book-convert';

export type WorkSlipBookEditorHandle = { getSnapshot: () => WorkSlipBookSnapshot | null };

type Props = {
  snapshot: WorkSlipBookSnapshot;
  onDirty: () => void;
  onReady: (handle: WorkSlipBookEditorHandle) => void;
};

// snapshot が変わるたびに(親が key で)作り直す。Univer 本体は初回描画時のみ生成する。
export default function WorkSlipBookEditor({ snapshot, onDirty, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbacks = useRef({ onDirty, onReady });
  callbacks.current = { onDirty, onReady };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.JA_JP,
      locales: { [LocaleType.JA_JP]: mergeLocales(sheetsCoreJaJP) },
      presets: [UniverSheetsCorePreset({ container })],
    });
    const book = univerAPI.createWorkbook(snapshot as never);
    callbacks.current.onReady({ getSnapshot: () => (book.save() as unknown as WorkSlipBookSnapshot) ?? null });

    // 初期描画で発生する変更は無視し、ユーザー操作のミューテーションだけ変更扱いにする
    let armed = false;
    const timer = window.setTimeout(() => {
      armed = true;
    }, 1500);
    const listener = book.onCommandExecuted((command) => {
      if (armed && command.type === CommandType.MUTATION) {
        callbacks.current.onDirty();
      }
    });

    return () => {
      window.clearTimeout(timer);
      listener.dispose();
      univer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot は初回のみ使う(差し替えは key で再生成)
  }, []);

  return <div ref={containerRef} className="h-full w-full" data-testid="work-slip-book-editor" />;
}
