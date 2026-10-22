import { normalizeScheduleCellEntryKind, normalizeScheduleCellNote } from './schedule-cell-entry';

export const SCHEDULE_LABEL_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
export type ScheduleLabelColor = (typeof SCHEDULE_LABEL_COLORS)[number];
export type ScheduleLabelTone = 'primary' | 'secondary';

export function isScheduleLabelColor(value: unknown): value is ScheduleLabelColor {
  return typeof value === 'string' && (SCHEDULE_LABEL_COLORS as readonly string[]).includes(value);
}

export function scheduleLabelTextClass(color: ScheduleLabelColor, tone: ScheduleLabelTone): string {
  if (color === 'default') {
    return tone === 'primary' ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400';
  }

  if (color === 'red') return tone === 'primary' ? 'text-red-600 dark:text-red-400' : 'text-red-500 dark:text-red-300';
  if (color === 'orange') return tone === 'primary' ? 'text-orange-600 dark:text-orange-400' : 'text-orange-500 dark:text-orange-300';
  if (color === 'yellow') return tone === 'primary' ? 'text-amber-600 dark:text-amber-300' : 'text-amber-500 dark:text-amber-200';
  if (color === 'green') return tone === 'primary' ? 'text-green-600 dark:text-green-400' : 'text-green-500 dark:text-green-300';
  if (color === 'blue') return tone === 'primary' ? 'text-blue-600 dark:text-blue-400' : 'text-blue-500 dark:text-blue-300';
  if (color === 'purple') return tone === 'primary' ? 'text-violet-600 dark:text-violet-400' : 'text-violet-500 dark:text-violet-300';
  return tone === 'primary' ? 'text-pink-600 dark:text-pink-400' : 'text-pink-500 dark:text-pink-300';
}

export type ScheduleCellDisplayItem = {
  label: string;
  /** セルに保存された色そのもの。サイトマスタ色は /api/schedule/* 側で解決済みなのでここでは再適用しない。 */
  color: ScheduleLabelColor;
  tone: ScheduleLabelTone;
  isNote: boolean;
};

/** PC/スマホ共通: グループの表示項目(ラベル・色・色調・追記か)を、結合文字列を介さず構造から作る。 */
export function buildScheduleCellGroupDisplay(group: {
  items: ReadonlyArray<{ label: string; color?: unknown; kind?: unknown }>;
  note?: unknown;
}): { items: ScheduleCellDisplayItem[]; groupNote: string | null } {
  const items = group.items
    .map((entry) => ({ entry, label: (entry.label ?? '').trim() }))
    .filter(({ label }) => label.length > 0)
    .map(({ entry, label }, index) => ({
      label,
      color: isScheduleLabelColor(entry.color) ? entry.color : ('default' as const),
      tone: index === 0 ? ('primary' as const) : ('secondary' as const),
      isNote: normalizeScheduleCellEntryKind(entry.kind) !== 'site',
    }));
  return { items, groupNote: normalizeScheduleCellNote(group.note) };
}
