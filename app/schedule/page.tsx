'use client';

import { useOutsidePointerDown } from '@/app/use-outside-pointerdown';
import {
  PERSONAL_SCHEDULE_COLOR_OPTIONS,
  PERSONAL_SCHEDULE_SLOT_COUNT,
  personalScheduleSurfaceClass,
  personalScheduleSwatchClass,
  type PersonalScheduleColor,
  type PersonalScheduleDay,
  type PersonalScheduleItem,
} from '@/shared/personal-schedule';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

type MonthApiResponse = {
  ok: true;
  month: string;
  user: { id: string; name: string | null; email: string | null };
  days: PersonalScheduleDay[];
};

type SlotMenuState = {
  dayYmd: string;
  slotIndex: number;
  item: PersonalScheduleItem | null;
  x: number;
  y: number;
};

type EditorState = {
  dayYmd: string;
  slotIndex: number;
  title: string;
  note: string;
  color: PersonalScheduleColor;
};

type ContentPreviewState = {
  dayYmd: string;
  slotIndex: number;
  title: string;
  note: string;
  color: PersonalScheduleColor;
  x: number;
  y: number;
  width: number;
};

const WEEKDAY_LABELS = [
  { key: 'sun', label: '日', className: 'text-red-500 dark:text-red-400' },
  { key: 'mon', label: '月', className: 'text-zinc-600 dark:text-zinc-300' },
  { key: 'tue', label: '火', className: 'text-zinc-600 dark:text-zinc-300' },
  { key: 'wed', label: '水', className: 'text-zinc-600 dark:text-zinc-300' },
  { key: 'thu', label: '木', className: 'text-zinc-600 dark:text-zinc-300' },
  { key: 'fri', label: '金', className: 'text-zinc-600 dark:text-zinc-300' },
  { key: 'sat', label: '土', className: 'text-blue-600 dark:text-blue-400' },
] as const;

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month: string, delta: number) {
  const [yearText, monthText] = month.split('-');
  const base = new Date(Number(yearText), Number(monthText) - 1 + delta, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}

function monthTitle(month: string) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const date = new Date(year, monthIndex, 1);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
  return { year, monthName };
}

function toYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isToday(dayYmd: string) {
  return dayYmd === toYmd(new Date());
}

function buildCalendarCells(month: string) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDay = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      key: toYmd(date),
      dayYmd: toYmd(date),
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      isSun: date.getDay() === 0,
      isSat: date.getDay() === 6,
      isToday: isToday(toYmd(date)),
    };
  });
}

function upsertDayItem(days: PersonalScheduleDay[], item: PersonalScheduleItem) {
  return days.map((day) => {
    if (day.dayYmd !== item.dayYmd) return day;
    const nextItems = [...day.items];
    nextItems[item.slotIndex] = item;
    return {
      ...day,
      items: nextItems,
      count: nextItems.filter((entry) => entry !== null).length,
    };
  });
}

function removeDayItem(days: PersonalScheduleDay[], dayYmd: string, slotIndex: number) {
  return days.map((day) => {
    if (day.dayYmd !== dayYmd) return day;
    const nextItems = [...day.items];
    nextItems[slotIndex] = null;
    return {
      ...day,
      items: nextItems,
      count: nextItems.filter((entry) => entry !== null).length,
    };
  });
}

function filledItems(day: PersonalScheduleDay | null) {
  return day?.items.filter((item): item is PersonalScheduleItem => item !== null) ?? [];
}

function nextOpenSlotIndex(day: PersonalScheduleDay | null) {
  if (!day) return 0;
  const index = day.items.findIndex((item) => item === null);
  return index >= 0 ? index : null;
}

export default function PersonalSchedulePage() {
  const [month, setMonth] = useState(currentMonthKey);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<PersonalScheduleDay[]>([]);
  const [isTouchLike, setIsTouchLike] = useState(false);
  const [menuState, setMenuState] = useState<SlotMenuState | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [previewState, setPreviewState] = useState<ContentPreviewState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useOutsidePointerDown({
    open: Boolean(menuState),
    refs: [menuRef],
    onOutside: () => setMenuState(null),
  });

  useOutsidePointerDown({
    open: Boolean(editorState),
    refs: [editorRef],
    onOutside: () => setEditorState(null),
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    setIsTouchLike(touch);
  }, []);

  const loadMonth = useCallback(async (targetMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/personal-schedule/month?month=${encodeURIComponent(targetMonth)}`, {
        cache: 'no-store',
      });
      const json = (await response.json().catch(() => null)) as unknown;
      const payload = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`);
      }
      const data = payload as unknown as MonthApiResponse;
      setDays(Array.isArray(data.days) ? data.days : []);
    } catch (cause) {
      setDays([]);
      setError(cause instanceof Error ? cause.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMonth(month);
  }, [loadMonth, month]);

  useEffect(() => {
    setMenuState(null);
    setEditorState(null);
    setPreviewState(null);
  }, [month]);

  useEffect(() => {
    if (!previewState) return;
    const closePreview = () => setPreviewState(null);
    window.addEventListener('resize', closePreview);
    window.addEventListener('scroll', closePreview, true);
    return () => {
      window.removeEventListener('resize', closePreview);
      window.removeEventListener('scroll', closePreview, true);
    };
  }, [previewState]);

  const dayMap = useMemo(() => new Map(days.map((day) => [day.dayYmd, day])), [days]);
  const calendarCells = useMemo(() => buildCalendarCells(month), [month]);
  const title = useMemo(() => monthTitle(month), [month]);

  const openSlotMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, dayYmd: string, slotIndex: number, item: PersonalScheduleItem | null) => {
      event.preventDefault();
      event.stopPropagation();
      setPreviewState(null);
      const rect = event.currentTarget.getBoundingClientRect();
      const width = typeof window !== 'undefined' ? window.innerWidth : 360;
      const height = typeof window !== 'undefined' ? window.innerHeight : 640;
      const left = isTouchLike
        ? Math.max(12, Math.min(rect.left, width - 280))
        : Math.max(12, Math.min(event.clientX, width - 280));
      const top = isTouchLike
        ? Math.max(12, Math.min(rect.bottom + 8, height - 220))
        : Math.max(12, Math.min(event.clientY, height - 220));
      setMenuState({ dayYmd, slotIndex, item, x: left, y: top });
    },
    [isTouchLike],
  );

  const openNewItemMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, dayYmd: string, day: PersonalScheduleDay | null) => {
      const slotIndex = nextOpenSlotIndex(day);
      if (slotIndex === null) {
        event.preventDefault();
        event.stopPropagation();
        setError(`この日は${PERSONAL_SCHEDULE_SLOT_COUNT}件まで入力済みです`);
        return;
      }
      openSlotMenu(event, dayYmd, slotIndex, null);
    },
    [openSlotMenu],
  );

  const openContentPreview = useCallback((target: HTMLElement, item: PersonalScheduleItem) => {
    if (!item.note || typeof window === 'undefined') {
      setPreviewState(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + 132 <= window.innerHeight ? preferredTop : Math.max(12, rect.top - 132);
    setPreviewState({
      dayYmd: item.dayYmd,
      slotIndex: item.slotIndex,
      title: item.title,
      note: item.note,
      color: item.color,
      x: left,
      y: top,
      width,
    });
  }, []);

  const openEditor = useCallback((dayYmd: string, slotIndex: number, item: PersonalScheduleItem | null) => {
    setEditorState({
      dayYmd,
      slotIndex,
      title: item?.title ?? '',
      note: item?.note ?? '',
      color: item?.color ?? 'emerald',
    });
    setMenuState(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorState) return;
    const titleValue = editorState.title.trim();
    if (!titleValue) {
      setError('タイトルを入力してください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/personal-schedule/month', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dayYmd: editorState.dayYmd,
          slotIndex: editorState.slotIndex,
          title: titleValue,
          note: editorState.note.trim() || null,
          color: editorState.color,
        }),
      });
      const json = (await response.json().catch(() => null)) as unknown;
      const payload = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`);
      }
      const item = (payload as { item: PersonalScheduleItem }).item;
      setDays((current) => upsertDayItem(current, item));
      setEditorState(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [editorState]);

  const handleDelete = useCallback(async () => {
    if (!menuState?.item) return;
    const ok = window.confirm('この予定を削除しますか？');
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/personal-schedule/month', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dayYmd: menuState.dayYmd, slotIndex: menuState.slotIndex }),
      });
      const json = (await response.json().catch(() => null)) as unknown;
      const payload = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`);
      }
      setDays((current) => removeDayItem(current, menuState.dayYmd, menuState.slotIndex));
      setMenuState(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '削除に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [menuState]);

  const handleColorChange = useCallback(async (color: PersonalScheduleColor) => {
    if (!menuState?.item) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/personal-schedule/month', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dayYmd: menuState.dayYmd,
          slotIndex: menuState.slotIndex,
          title: menuState.item.title,
          note: menuState.item.note,
          color,
        }),
      });
      const json = (await response.json().catch(() => null)) as unknown;
      const payload = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`);
      }
      const item = (payload as { item: PersonalScheduleItem }).item;
      setDays((current) => upsertDayItem(current, item));
      setMenuState((current) => (current ? { ...current, item } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '色変更に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [menuState]);

  return (
    <main className="mx-auto max-w-[1600px] p-2 sm:p-3">
      <div className="rounded-2xl border border-zinc-200 bg-white/90 p-3 shadow-sm dark:border-zinc-800 dark:bg-black/80 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">スケジュール</h1>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              入力済みの予定だけ表示します。PC はタイトルにカーソルで内容確認、右クリックで編集できます。
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              スマホはタイトルをタップで内容表示、日付セルの空白をタップで新規入力です。
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth((current) => addMonths(current, -1))}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
            >
              ← 前月
            </button>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              aria-label="表示月"
            />
            <button
              type="button"
              onClick={() => setMonth((current) => addMonths(current, 1))}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
            >
              次月 →
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/20 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4 sm:py-3">
            <div className="flex items-baseline gap-3 text-zinc-950 dark:text-zinc-50">
              <span className="text-3xl font-black leading-none sm:text-4xl">{title.monthName}</span>
              <span className="text-2xl font-semibold leading-none sm:text-3xl">{title.year}</span>
            </div>
            {loading ? <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div> : null}
          </div>

          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/70">
            {WEEKDAY_LABELS.map((day) => (
              <div
                key={day.key}
                className={`border-r border-zinc-200 px-1 py-1.5 text-center text-[11px] font-semibold last:border-r-0 dark:border-zinc-800 sm:px-2 sm:py-2 sm:text-xs ${day.className}`}
              >
                {day.label}
              </div>
            ))}
          </div>

          <div
            className="grid grid-cols-7 auto-rows-fr"
            style={isTouchLike ? undefined : { height: 'clamp(520px, calc(100vh - 220px), 760px)' }}
          >
            {calendarCells.map((cell) => {
              const day = dayMap.get(cell.dayYmd) ?? null;
              const items = filledItems(day);
              const availableSlotIndex = nextOpenSlotIndex(day);
              return (
                <div
                  key={cell.key}
                  onContextMenu={(event) => {
                    if (!cell.inMonth || saving) return;
                    openNewItemMenu(event, cell.dayYmd, day);
                  }}
                  onClick={(event) => {
                    if (!isTouchLike || !cell.inMonth || saving) return;
                    const target = event.target as HTMLElement;
                    if (target.closest('button')) return;
                    openNewItemMenu(event, cell.dayYmd, day);
                  }}
                  className={`relative flex min-h-[92px] min-w-0 flex-col border-r border-b border-zinc-200 p-1.5 align-top last:border-r-0 dark:border-zinc-800 sm:p-2 ${
                    cell.inMonth ? 'bg-white dark:bg-zinc-950' : 'bg-zinc-50/60 dark:bg-zinc-950/50'
                  } ${cell.isToday ? 'ring-1 ring-inset ring-blue-400 dark:ring-blue-500' : ''}`}
                >
                  <div className="mb-1 flex items-start justify-between gap-1">
                    <div
                      className={`text-xs font-semibold sm:text-sm ${
                        cell.inMonth
                          ? cell.isSun
                            ? 'text-red-600 dark:text-red-400'
                            : cell.isSat
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-zinc-900 dark:text-zinc-100'
                          : 'text-zinc-400 dark:text-zinc-600'
                      }`}
                    >
                      {cell.dayNumber}
                    </div>

                    {cell.inMonth && availableSlotIndex !== null ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openEditor(cell.dayYmd, availableSlotIndex, null);
                        }}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        aria-label={`${cell.dayYmd} に予定を追加`}
                        title="新規入力"
                      >
                        +
                      </button>
                    ) : null}
                  </div>

                  <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
                    {items.map((item) => (
                      <button
                        key={`${item.dayYmd}:${item.slotIndex}`}
                        type="button"
                        disabled={!cell.inMonth || saving}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!isTouchLike) return;
                          openSlotMenu(event, item.dayYmd, item.slotIndex, item);
                        }}
                        onContextMenu={(event) => openSlotMenu(event, item.dayYmd, item.slotIndex, item)}
                        onMouseEnter={(event) => {
                          if (isTouchLike) return;
                          openContentPreview(event.currentTarget, item);
                        }}
                        onMouseLeave={() => {
                          setPreviewState((current) =>
                            current?.dayYmd === item.dayYmd && current.slotIndex === item.slotIndex ? null : current,
                          );
                        }}
                        className={`flex min-h-[24px] w-full items-center rounded-md border px-2 py-1 text-left text-[10px] font-semibold shadow-sm transition sm:text-[11px] ${personalScheduleSurfaceClass(item.color)} disabled:cursor-default disabled:opacity-70`}
                        title={isTouchLike ? undefined : item.title}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {previewState && !isTouchLike ? (
        <div
          className="pointer-events-none fixed z-[88] rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
          style={{ left: `${previewState.x}px`, top: `${previewState.y}px`, width: `${previewState.width}px` }}
        >
          <div className="flex items-start gap-2">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${personalScheduleSwatchClass(previewState.color)}`} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{previewState.title}</div>
              <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                {previewState.note}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {menuState ? (
        <div
          ref={menuRef}
          className={`fixed z-[90] w-[260px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 ${
            isTouchLike ? 'left-3 right-3 bottom-4 w-auto' : ''
          }`}
          style={isTouchLike ? undefined : { left: `${menuState.x}px`, top: `${menuState.y}px` }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="border-b border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {menuState.dayYmd} / 枠 {menuState.slotIndex + 1}
          </div>
          <div className="border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
            {menuState.item ? (
              <div className="flex items-start gap-2">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${personalScheduleSwatchClass(menuState.item.color)}`} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{menuState.item.title}</div>
                  <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                    {menuState.item.note || '内容は未入力です'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                未入力です。ここに新しい予定を追加できます。
              </div>
            )}
          </div>
          <div className="p-2">
            <button
              type="button"
              onClick={() => openEditor(menuState.dayYmd, menuState.slotIndex, menuState.item)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              {menuState.item ? '編集' : '入力'}
            </button>
            <button
              type="button"
              disabled={!menuState.item || saving}
              onClick={() => void handleDelete()}
              className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              削除
            </button>
          </div>
          <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            色編集
          </div>
          <div className="grid grid-cols-6 gap-2 p-3">
            {PERSONAL_SCHEDULE_COLOR_OPTIONS.map((color) => {
              const selected = menuState.item?.color === color.value;
              return (
                <button
                  key={color.value}
                  type="button"
                  disabled={!menuState.item || saving}
                  onClick={() => void handleColorChange(color.value)}
                  className={`flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black ${
                    selected ? 'ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-black' : ''
                  }`}
                  title={color.label}
                >
                  <span className={`h-4 w-4 rounded-full ${personalScheduleSwatchClass(color.value)}`} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {editorState ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4">
          <div
            ref={editorRef}
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {editorState.dayYmd} / 枠 {editorState.slotIndex + 1}
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-xs text-zinc-500 dark:text-zinc-400">
                タイトル
                <input
                  type="text"
                  maxLength={80}
                  value={editorState.title}
                  onChange={(event) =>
                    setEditorState((current) => (current ? { ...current, title: event.target.value } : current))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-black dark:text-zinc-100"
                />
              </label>

              <label className="block text-xs text-zinc-500 dark:text-zinc-400">
                内容
                <textarea
                  rows={4}
                  maxLength={500}
                  value={editorState.note}
                  onChange={(event) =>
                    setEditorState((current) => (current ? { ...current, note: event.target.value } : current))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-black dark:text-zinc-100"
                />
              </label>

              <div className="text-xs text-zinc-500 dark:text-zinc-400">色</div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {PERSONAL_SCHEDULE_COLOR_OPTIONS.map((color) => {
                  const selected = editorState.color === color.value;
                  return (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() =>
                        setEditorState((current) => (current ? { ...current, color: color.value } : current))
                      }
                      className={`flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black ${
                        selected ? 'ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-black' : ''
                      }`}
                    >
                      <span className={`h-4 w-4 rounded-full ${personalScheduleSwatchClass(color.value)}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditorState(null)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                閉じる
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-lg border border-blue-300 bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}