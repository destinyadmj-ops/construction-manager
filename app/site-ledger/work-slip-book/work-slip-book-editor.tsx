'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { createUniver, LocaleType, mergeLocales, CommandType } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreJaJP from '@univerjs/preset-sheets-core/locales/ja-JP';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { WorkSlipBookSnapshot } from '@/shared/work-slip-book-convert';

type UniverApi = ReturnType<typeof createUniver>['univerAPI'];

const COL_MIN = 10;
const COL_MAX = 500;
const ROW_MIN = 10;
const ROW_MAX = 300;

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
  const [api, setApi] = useState<UniverApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.JA_JP,
      locales: { [LocaleType.JA_JP]: mergeLocales(sheetsCoreJaJP) },
      presets: [UniverSheetsCorePreset({ container })],
    });
    const book = univerAPI.createWorkbook(snapshot as never);
    setApi(univerAPI);
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
      setApi(null);
      univer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot は初回のみ使う(差し替えは key で再生成)
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" data-testid="work-slip-book-editor" />
      {api ? <SizeControls api={api} /> : null}
    </div>
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

// Univer の「開始/数式/表示」タブ行の空きに重ねる。シート全体の列幅・行高を 1px 刻みで一括変更し、変更は MUTATION なので未保存扱い・Ctrl+Z で戻せる。
function SizeControls({ api }: { api: UniverApi }) {
  const [colText, setColText] = useState('');
  const [rowText, setRowText] = useState('');

  useEffect(() => {
    const refresh = () => {
      const sheet = api.getActiveWorkbook()?.getActiveSheet();
      const range = sheet?.getSelection()?.getActiveRange();
      if (!sheet || !range) return;
      setColText(String(Math.round(sheet.getColumnWidth(range.getColumn()))));
      setRowText(String(Math.round(sheet.getRowHeight(range.getRow()))));
    };
    refresh();
    const subs = [api.addEvent(api.Event.SelectionChanged, refresh), api.addEvent(api.Event.ActiveSheetChanged, refresh)];
    return () => subs.forEach((s) => s.dispose());
  }, [api]);

  const applyCol = (raw: string) => {
    const n = Number(raw);
    const sheet = api.getActiveWorkbook()?.getActiveSheet();
    if (!sheet || raw.trim() === '' || !Number.isFinite(n)) return;
    const width = clamp(n, COL_MIN, COL_MAX);
    setColText(String(width));
    sheet.setColumnWidths(0, sheet.getMaxColumns(), width);
  };
  const applyRow = (raw: string) => {
    const n = Number(raw);
    const sheet = api.getActiveWorkbook()?.getActiveSheet();
    if (!sheet || raw.trim() === '' || !Number.isFinite(n)) return;
    const height = clamp(n, ROW_MIN, ROW_MAX);
    setRowText(String(height));
    sheet.setRowHeights(0, sheet.getMaxRows(), height);
  };

  // 上下ボタン/矢印キーの変更は inputType を持たない。その時だけ即時反映し、手入力は Enter か blur で反映する。
  const onChange = (set: (v: string) => void, apply: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    if (!(e.nativeEvent as InputEvent).inputType) apply(e.target.value);
  };
  const onKey = (apply: (v: string) => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') apply(e.currentTarget.value);
  };

  const input = 'h-5 w-16 rounded border border-zinc-300 bg-white px-1 text-[11px] text-zinc-800';
  return (
    <div className="pointer-events-none absolute left-2 top-0 z-10 hidden h-9 items-center min-[640px]:flex" data-testid="work-slip-book-size-controls">
      <div className="pointer-events-auto flex items-center gap-1.5">
        <label className="flex flex-col gap-px text-[10px] leading-none text-zinc-600" title="シート全体の列幅(px)を一括で変更します。個別に調整した列幅も上書きされます(Ctrl+Z で元に戻せます)">
          列
          <input
            type="number"
            className={input}
            min={COL_MIN}
            max={COL_MAX}
            step={1}
            value={colText}
            aria-label="列幅(px)"
            onChange={onChange(setColText, applyCol)}
            onBlur={(e) => applyCol(e.currentTarget.value)}
            onKeyDown={onKey(applyCol)}
          />
        </label>
        <span aria-hidden className="h-8 w-8 rounded-tl-md border-l-[3px] border-t-[3px] border-zinc-500" />
        <label className="flex flex-col gap-px text-[10px] leading-none text-zinc-600" title="シート全体の行高(px)を一括で変更します。個別に調整した行高も上書きされます(Ctrl+Z で元に戻せます)">
          行
          <input
            type="number"
            className={input}
            min={ROW_MIN}
            max={ROW_MAX}
            step={1}
            value={rowText}
            aria-label="行高(px)"
            onChange={onChange(setRowText, applyRow)}
            onBlur={(e) => applyRow(e.currentTarget.value)}
            onKeyDown={onKey(applyRow)}
          />
        </label>
      </div>
    </div>
  );
}
