'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import { buildAutoFillTargets, buildRepeatRuleWithPace, hasConfiguredPace, type RepeatRule } from '@/shared/pace';
import {
  cloneScheduleSyncSource,
  createScheduleSyncSource,
  scheduleSyncSourceEquals,
  type ScheduleSyncSource,
} from '@/shared/schedule-sync-source';
import {
  formatScheduleCellGroupDisplayValue,
  normalizeScheduleCellNote,
  normalizeScheduleCellEntryKind,
  type ScheduleCellEntryKind,
} from '@/shared/schedule-cell-entry';
import { findSiteFamily, siteFamilyDisplayName, stripSiteFamilyLabel } from '@/shared/site-family';
import {
  DEFAULT_WEEK_GRID_PREFS,
  WEEK_GRID_PREFS_VERSION,
  buildNameColumnTrack,
  clampNameColumnWidth,
  normalizeWeekGridPrefs,
  type WeekGridCellBg as CellBg,
  type WeekGridTextColor as CellTextColor,
} from '@/shared/week-grid-prefs';
import {
  consumeForceDesktopWeekHomeOnce,
  getCurrentPathWithSearch,
  readStoredScheduleReturn,
  writeStoredScheduleReturn,
} from '@/shared/schedule-return';
import { readColorEditMode, writeColorEditMode } from './color-edit';
import { useHeaderActions } from './header-actions';
import { writeCachedUserCandidates } from './user-candidate-cache';

type ViewMode = 'week' | 'month' | 'year';

type ScheduleKind = 'normal' | 'daily';
type WeekHubSelectedCellState = { userId: string; day: string };
type WeekHubEditSource = 'direct' | 'button';
type WeekHubEditingCellState = {
  userId: string;
  day: string;
  slotIndex: number;
  source: WeekHubEditSource;
  targetItemIndex: number | null;
};
type WeekHubHistoryState = {
  v: 1;
  mode: ViewMode;
  scheduleKind: ScheduleKind;
  cursorDate: string;
  selectedUserId: string | null;
  selectedCell: WeekHubSelectedCellState | null;
  editingCell: WeekHubEditingCellState | null;
  editingInput: string;
};

const WEEK_HUB_HISTORY_STATE_KEY = 'masterHub.weekHubState';

type GridLayout = 'compact' | 'comfortable';
type CellClickAction = 'toggle' | 'add' | 'remove' | 'replace2' | 'swap' | 'recolor';
const LABEL_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
const MAX_CELL_GROUPS = 4;
const MAX_GROUP_ITEMS = 4;
type LabelColor = (typeof LABEL_COLORS)[number];
type ApiCellEntry = {
  label: string;
  color: LabelColor;
  kind?: ScheduleCellEntryKind | null;
  syncSource?: ScheduleSyncSource | null;
};
type ApiCellGroup = { items: ApiCellEntry[]; note?: string | null };

type ApiUser = { id: string; name: string | null; email: string | null };

type AuthMeUser = {
  id: string;
  name: string | null;
  email: string | null;
  canEditSchedule: boolean;
  canGrantScheduleEdit: boolean;
};

type ApiCell = {
  // Up to 2 slots. Each slot is a short label.
  slot1: string | null;
  slot2: string | null;
  // Optional hint color for each slot.
  color1: LabelColor;
  color2: LabelColor;
  entries?: ApiCellEntry[];
  groups?: ApiCellGroup[];
};

type ApiResponse = {
  ok: true;
  weekStart: string;
  users: ApiUser[];
  grid: Record<string, Record<string, ApiCell>>; // userId -> day(yyyy-mm-dd) -> cell
};

type MonthApiResponse = {
  ok: true;
  month: string; // YYYY-MM
  days: string[];
  users: ApiUser[];
  grid: Record<string, Record<string, ApiCell>>;
};

type YearSummaryApiResponse = {
  ok: true;
  year: number;
  months: string[]; // YYYY-MM x 12
  users: ApiUser[];
  grid: Record<string, Record<string, { entries: number; days: number }>>;
};

type SiteItem = {
  id: string | null;
  label: string;
  name?: string | null;
  companyName?: string | null;
  scheduleLabelColor?: LabelColor | null;
  badgeMonthVisible?: boolean;
  invoiceIssuedThisMonth?: boolean;
  reportIssuedThisMonth?: boolean;
  paceNotConsumedAlert?: boolean;
  unassignedThisMonth?: boolean;
  pace?: string | null;
  repeatRule?: unknown;
  contactName?: string | null;
  createdAt?: string | null;
};

type CellHistoryEntry = {
  kind: 'cell';
  userId: string;
  day: string; // YYYY-MM-DD
  before: ApiCell;
  after: ApiCell;
  editorLabel: string;
  at: number;
};

type DraggedCellState = { userId: string; day: string; cell: ApiCell };

type CellHoverMenuItem = {
  key: string;
  kind: 'site' | 'note';
  label: string;
  siteName?: string | null;
  className?: string;
};

type SlotContextMenuState = {
  day: string;
  siteName: string;
  color: LabelColor;
  beforeCell: ApiCell;
  x: number;
  y: number;
  companyName: string | null;
  entryKind: ScheduleCellEntryKind;
  groupIndex: number;
  groupNote: string | null;
  mode: 'actions' | 'change-color' | 'assign-users' | 'related-sites' | 'append-note';
  selectedUserIds: string[];
  selectedSiblingNames: string[];
  noteDraft: string;
};

type SlotContextRelatedSiteOption = {
  site: SiteItem;
  storedName: string;
  displayName: string;
  checked: boolean;
  disabled: boolean;
};

type ScheduleChangeHistoryItem = {
  id: string;
  dayYmd: string;
  targetUserId: string;
  targetUserLabel: string;
  projectLabel: string;
  targetLabel: string;
  beforeValue: string;
  afterValue: string;
  beforeGroups?: ApiCellGroup[] | null;
  afterGroups?: ApiCellGroup[] | null;
  editorLabel: string;
  editorHost: string;
  editorPlatform: string;
  editorLanguage: string;
  editorTimeZone: string;
  createdAt: string;
};

const HISTORY_GROUP_MS = 800;

function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === 'string' && (LABEL_COLORS as readonly string[]).includes(value);
}

function resolveSiteLabelColor(site: SiteItem | null | undefined, fallback: LabelColor = 'default'): LabelColor {
  return isLabelColor(site?.scheduleLabelColor) ? site.scheduleLabelColor : fallback;
}

function siteSearchHighlightClass(color: LabelColor | null | undefined): string {
  const resolved = isLabelColor(color) ? color : 'default';
  if (resolved === 'default') return 'border-red-200 bg-red-50/80 dark:border-red-800 dark:bg-red-950/30';
  if (resolved === 'red') return 'border-red-200 bg-red-50/80 dark:border-red-800 dark:bg-red-950/30';
  if (resolved === 'orange') return 'border-orange-200 bg-orange-50/80 dark:border-orange-800 dark:bg-orange-950/30';
  if (resolved === 'yellow') return 'border-amber-200 bg-amber-50/85 dark:border-amber-700 dark:bg-amber-950/30';
  if (resolved === 'green') return 'border-green-200 bg-green-50/80 dark:border-green-800 dark:bg-green-950/30';
  if (resolved === 'blue') return 'border-blue-200 bg-blue-50/80 dark:border-blue-800 dark:bg-blue-950/30';
  if (resolved === 'purple') return 'border-violet-200 bg-violet-50/80 dark:border-violet-800 dark:bg-violet-950/30';
  return 'border-pink-200 bg-pink-50/80 dark:border-pink-800 dark:bg-pink-950/30';
}

function siteSearchHighlightStyle(color: LabelColor | null | undefined): CSSProperties {
  const resolved = isLabelColor(color) ? color : 'default';
  const vars =
    resolved === 'red'
      ? {
          lightBorder: 'rgb(254 202 202)',
          lightBackground: 'rgba(254, 242, 242, 0.88)',
          darkBorder: 'rgb(127 29 29)',
          darkBackground: 'rgba(69, 10, 10, 0.45)',
        }
      : resolved === 'orange'
        ? {
            lightBorder: 'rgb(254 215 170)',
            lightBackground: 'rgba(255, 247, 237, 0.9)',
            darkBorder: 'rgb(154 52 18)',
            darkBackground: 'rgba(67, 20, 7, 0.45)',
          }
        : resolved === 'yellow'
          ? {
              lightBorder: 'rgb(253 230 138)',
              lightBackground: 'rgba(254, 252, 232, 0.92)',
              darkBorder: 'rgb(133 77 14)',
              darkBackground: 'rgba(66, 32, 6, 0.5)',
            }
          : resolved === 'green'
            ? {
                lightBorder: 'rgb(187 247 208)',
                lightBackground: 'rgba(240, 253, 244, 0.9)',
                darkBorder: 'rgb(22 101 52)',
                darkBackground: 'rgba(5, 46, 22, 0.45)',
              }
            : resolved === 'blue'
              ? {
                  lightBorder: 'rgb(191 219 254)',
                  lightBackground: 'rgba(239, 246, 255, 0.9)',
                  darkBorder: 'rgb(30 64 175)',
                  darkBackground: 'rgba(23, 37, 84, 0.45)',
                }
              : resolved === 'purple'
                ? {
                    lightBorder: 'rgb(221 214 254)',
                    lightBackground: 'rgba(245, 243, 255, 0.9)',
                    darkBorder: 'rgb(91 33 182)',
                    darkBackground: 'rgba(46, 16, 101, 0.45)',
                  }
                : resolved === 'pink'
                  ? {
                      lightBorder: 'rgb(251 207 232)',
                      lightBackground: 'rgba(253, 242, 248, 0.9)',
                      darkBorder: 'rgb(157 23 77)',
                      darkBackground: 'rgba(80, 7, 36, 0.45)',
                    }
                  : {
                      lightBorder: 'rgb(254 202 202)',
                      lightBackground: 'rgba(254, 242, 242, 0.88)',
                      darkBorder: 'rgb(127 29 29)',
                      darkBackground: 'rgba(69, 10, 10, 0.45)',
                    };

  return {
    '--mh-button-border-light': vars.lightBorder,
    '--mh-button-bg-light': vars.lightBackground,
    '--mh-button-border-dark': vars.darkBorder,
    '--mh-button-bg-dark': vars.darkBackground,
    boxShadow: `inset 0 0 0 1px ${vars.lightBorder}`,
  } as CSSProperties;
}

function normalizeOrderedNames(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function isSiteCellEntry(entry: ApiCellEntry | null | undefined) {
  return normalizeScheduleCellEntryKind(entry?.kind) === 'site';
}

function labelTextClass(color: LabelColor, tone: 'primary' | 'secondary'): string {
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

function ColumnResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label="従業員名の列幅を調整"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="absolute inset-y-0 right-0 z-20 flex w-3 translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
      title="従業員名の幅を調整"
    >
      <div className="h-8 w-px rounded-full bg-zinc-300 dark:bg-zinc-700" />
    </div>
  );
}

function arrayEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function orderUsers(users: ApiUser[], order: string[]) {
  const filteredUsers = users.filter((u) => {
    const name = (u.name ?? '').trim();
    const email = (u.email ?? '').trim();
    return !(name === 'E2E Cell User' && email.endsWith('@example.test'));
  });

  if (!order || order.length === 0) return filteredUsers;
  const byId = new Map(filteredUsers.map((u) => [u.id, u] as const));
  const used = new Set<string>();
  const next: ApiUser[] = [];
  for (const id of order) {
    const u = byId.get(id);
    if (!u) continue;
    next.push(u);
    used.add(id);
  }
  for (const u of filteredUsers) {
    if (used.has(u.id)) continue;
    next.push(u);
  }
  return next;
}

function normalizeUserOrder(order: string[], users: ApiUser[]) {
  const set = new Set(users.map((u) => u.id));
  const filtered = order.filter((id) => set.has(id));
  const used = new Set(filtered);
  const appended = users.filter((u) => !used.has(u.id)).map((u) => u.id);
  return [...filtered, ...appended];
}

function cloneCellGroupItems(items: ApiCellEntry[] | null | undefined): ApiCellEntry[] {
  return (items ?? [])
    .map((entry) => ({
      label: typeof entry?.label === 'string' ? entry.label.trim() : '',
      color: isLabelColor(entry?.color) ? entry.color : 'default',
      kind: normalizeScheduleCellEntryKind(entry?.kind),
      syncSource: isSiteCellEntry(entry) ? cloneScheduleSyncSource(entry?.syncSource) : null,
    }))
    .filter((entry) => entry.label.length > 0);
}

function createCellEntry(
  label: string,
  color: LabelColor,
  options?: { kind?: ScheduleCellEntryKind | null; syncSource?: ScheduleSyncSource | null },
): ApiCellEntry {
  const kind = normalizeScheduleCellEntryKind(options?.kind);
  const nextSyncSource = kind === 'site' ? cloneScheduleSyncSource(options?.syncSource) : null;
  if (kind === 'note') return { label, color, kind };
  return nextSyncSource ? { label, color, kind, syncSource: nextSyncSource } : { label, color, kind };
}

function cloneCellGroups(groups: ApiCellGroup[] | null | undefined): ApiCellGroup[] {
  return (groups ?? [])
    .map((group) => ({ items: cloneCellGroupItems(group?.items), note: normalizeScheduleCellNote(group?.note) }))
    .filter((group) => group.items.length > 0);
}

function apiCellToGroups(cell: ApiCell | null | undefined): ApiCellGroup[] {
  const normalizedGroups = cloneCellGroups(cell?.groups);
  if (normalizedGroups.length > 0) return normalizedGroups;

  const groups: ApiCellGroup[] = [];
  if (cell?.slot1) groups.push({ items: [createCellEntry(cell.slot1, cell.color1 ?? 'default', { kind: 'site' })] });
  if (cell?.slot2) groups.push({ items: [createCellEntry(cell.slot2, cell.color2 ?? 'default', { kind: 'site' })] });
  return groups;
}

function apiCellGroupValue(group: ApiCellGroup | null | undefined) {
  const parts = cloneCellGroupItems(group?.items).map((item) => item.label);
  return formatScheduleCellGroupDisplayValue(parts, group?.note);
}

function apiCellGroupsEqual(a: ApiCellGroup[] | null | undefined, b: ApiCellGroup[] | null | undefined) {
  const left = cloneCellGroups(a);
  const right = cloneCellGroups(b);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItems = left[index]?.items ?? [];
    const rightItems = right[index]?.items ?? [];
    if (leftItems.length !== rightItems.length) return false;
    for (let itemIndex = 0; itemIndex < leftItems.length; itemIndex += 1) {
      if (leftItems[itemIndex]?.label !== rightItems[itemIndex]?.label) return false;
      if (leftItems[itemIndex]?.color !== rightItems[itemIndex]?.color) return false;
      if (normalizeScheduleCellEntryKind(leftItems[itemIndex]?.kind) !== normalizeScheduleCellEntryKind(rightItems[itemIndex]?.kind)) return false;
      if (!scheduleSyncSourceEquals(leftItems[itemIndex]?.syncSource, rightItems[itemIndex]?.syncSource)) return false;
    }
    if (normalizeScheduleCellNote(left[index]?.note) !== normalizeScheduleCellNote(right[index]?.note)) return false;
  }
  return true;
}

function apiCellsEqual(a: ApiCell | null | undefined, b: ApiCell | null | undefined) {
  const hasExplicitGroups = Array.isArray(a?.groups) || Array.isArray(b?.groups);
  if (hasExplicitGroups) return apiCellGroupsEqual(a?.groups, b?.groups);
  return (
    (a?.slot1 ?? null) === (b?.slot1 ?? null) &&
    (a?.slot2 ?? null) === (b?.slot2 ?? null) &&
    (a?.color1 ?? 'default') === (b?.color1 ?? 'default') &&
    (a?.color2 ?? 'default') === (b?.color2 ?? 'default')
  );
}

function cloneApiCell(cell: ApiCell | null | undefined): ApiCell {
  const groups = apiCellToGroups(cell);
  const flatEntries = groups.flatMap((group) => group.items);
  return {
    slot1: apiCellGroupValue(groups[0]) ?? null,
    slot2: apiCellGroupValue(groups[1]) ?? null,
    color1: groups[0]?.items[0]?.color ?? 'default',
    color2: groups[1]?.items[0]?.color ?? 'default',
    entries: flatEntries,
    groups,
  };
}

type CellEntry = ApiCellEntry;

function apiCellToEntries(cell: ApiCell | null | undefined): CellEntry[] {
  return apiCellToGroups(cell).flatMap((group) => group.items);
}

function apiCellToSiteEntries(cell: ApiCell | null | undefined): CellEntry[] {
  return apiCellToEntries(cell).filter((entry) => isSiteCellEntry(entry));
}

function groupsToApiCell(groups: ApiCellGroup[]): ApiCell {
  const normalizedGroups = cloneCellGroups(groups);
  const normalizedEntries = normalizedGroups.flatMap((group) => group.items);
  return {
    slot1: apiCellGroupValue(normalizedGroups[0]) ?? null,
    slot2: apiCellGroupValue(normalizedGroups[1]) ?? null,
    color1: normalizedGroups[0]?.items[0]?.color ?? 'default',
    color2: normalizedGroups[1]?.items[0]?.color ?? 'default',
    entries: normalizedEntries,
    groups: normalizedGroups,
  };
}

function previewCellAction(input: {
  cell: ApiCell | null | undefined;
  action: CellClickAction;
  siteName?: string | null;
  color: CellTextColor;
  familyKeyForSiteName?: (siteName: string) => string | null;
  allowSiblingMerge?: boolean;
  newEntryKind?: ScheduleCellEntryKind;
  newEntrySyncSource?: ScheduleSyncSource | null;
}): {
  cell: ApiCell;
  changed: boolean;
  reason?: string;
  toggled?: 'off' | 'on';
  replaced?: 'last-slot';
} {
  const currentCell = cloneApiCell(input.cell);
  const groups = apiCellToGroups(currentCell);
  const siteName = input.siteName?.trim() ?? '';
  const hitGroupIndex = siteName
    ? groups.findIndex((group) => group.items.some((entry) => isSiteCellEntry(entry) && entry.label === siteName))
    : -1;
  const hitItemIndex = hitGroupIndex >= 0
    ? groups[hitGroupIndex]?.items.findIndex((entry) => isSiteCellEntry(entry) && entry.label === siteName) ?? -1
    : -1;
  const targetFamilyKey = siteName ? input.familyKeyForSiteName?.(siteName) ?? null : null;
  const allowSiblingMerge = input.allowSiblingMerge !== false;
  const siblingGroupIndex = targetFamilyKey
    ? groups.findIndex((group) =>
        group.items.some((entry) => isSiteCellEntry(entry) && input.familyKeyForSiteName?.(entry.label) === targetFamilyKey),
      )
    : -1;

  const createSiteGroupEntry = () =>
    createCellEntry(siteName, input.color, {
      kind: input.newEntryKind ?? 'site',
      syncSource: input.newEntrySyncSource,
    });

  const updateGroups = (nextGroups: ApiCellGroup[]) => groupsToApiCell(nextGroups);

  switch (input.action) {
    case 'swap':
      if (groups.length < 2) return { cell: currentCell, changed: false, reason: 'not-enough-entries' };
      return { cell: updateGroups([groups[1]!, groups[0]!]), changed: true };
    case 'recolor':
      if (!siteName || hitGroupIndex < 0 || hitItemIndex < 0) {
        return { cell: currentCell, changed: false, reason: 'not-found' };
      }
      return {
        cell: updateGroups(
          groups.map((group, groupIndex) =>
            groupIndex !== hitGroupIndex
              ? group
              : {
                  ...group,
                  items: group.items.map((entry, itemIndex) =>
                    itemIndex === hitItemIndex ? { ...entry, color: input.color } : entry,
                  ),
                },
          ),
        ),
        changed: true,
      };
    case 'remove':
      if (!siteName || hitGroupIndex < 0 || hitItemIndex < 0) {
        return { cell: currentCell, changed: false, reason: 'not-found' };
      }
      return {
        cell: updateGroups(
          groups
            .map((group, groupIndex) =>
              groupIndex !== hitGroupIndex
                ? group
                : { ...group, items: group.items.filter((_, itemIndex) => itemIndex !== hitItemIndex) },
            )
            .filter((group) => group.items.length > 0),
        ),
        changed: true,
      };
    case 'toggle':
      if (siteName && hitGroupIndex >= 0 && hitItemIndex >= 0) {
        return {
          cell: updateGroups(
            groups
              .map((group, groupIndex) =>
                groupIndex !== hitGroupIndex
                  ? group
                  : { ...group, items: group.items.filter((_, itemIndex) => itemIndex !== hitItemIndex) },
              )
              .filter((group) => group.items.length > 0),
          ),
          changed: true,
          toggled: 'off',
        };
      }
      if (!siteName) return { cell: currentCell, changed: false, reason: 'not-found' };
      if (allowSiblingMerge && siblingGroupIndex >= 0) {
        const siblingGroup = groups[siblingGroupIndex]!;
        if (siblingGroup.items.length >= MAX_GROUP_ITEMS) {
          return { cell: currentCell, changed: false, reason: 'group-full' };
        }
        return {
          cell: updateGroups(
            groups.map((group, groupIndex) =>
              groupIndex !== siblingGroupIndex
                ? group
                : { ...group, items: [...group.items, createSiteGroupEntry()] },
            ),
          ),
          changed: true,
          toggled: 'on',
        };
      }
      if (groups.length >= MAX_CELL_GROUPS) return { cell: currentCell, changed: false, reason: 'cell-full' };
      return {
        cell: updateGroups([...groups, { items: [createSiteGroupEntry()] }]),
        changed: true,
        toggled: 'on',
      };
    case 'add':
      if (!siteName) return { cell: currentCell, changed: false, reason: 'not-found' };
      if (hitGroupIndex >= 0) return { cell: currentCell, changed: false, reason: 'already-exists' };
      if (allowSiblingMerge && siblingGroupIndex >= 0) {
        const siblingGroup = groups[siblingGroupIndex]!;
        if (siblingGroup.items.length >= MAX_GROUP_ITEMS) return { cell: currentCell, changed: false, reason: 'group-full' };
        return {
          cell: updateGroups(
            groups.map((group, groupIndex) =>
              groupIndex !== siblingGroupIndex
                ? group
                : { ...group, items: [...group.items, createSiteGroupEntry()] },
            ),
          ),
          changed: true,
        };
      }
      if (groups.length >= MAX_CELL_GROUPS) return { cell: currentCell, changed: false, reason: 'cell-full' };
      return {
        cell: updateGroups([...groups, { items: [createSiteGroupEntry()] }]),
        changed: true,
      };
    case 'replace2':
      if (!siteName) return { cell: currentCell, changed: false, reason: 'not-found' };
      if (hitGroupIndex >= 0) return { cell: currentCell, changed: false, reason: 'already-exists' };
      if (allowSiblingMerge && siblingGroupIndex >= 0) {
        const siblingGroup = groups[siblingGroupIndex]!;
        if (siblingGroup.items.length >= MAX_GROUP_ITEMS) return { cell: currentCell, changed: false, reason: 'group-full' };
        return {
          cell: updateGroups(
            groups.map((group, groupIndex) =>
              groupIndex !== siblingGroupIndex
                ? group
                : { ...group, items: [...group.items, createSiteGroupEntry()] },
            ),
          ),
          changed: true,
        };
      }
      if (groups.length >= MAX_CELL_GROUPS) {
        return {
          cell: updateGroups([...groups.slice(0, -1), { items: [createSiteGroupEntry()] }]),
          changed: true,
          replaced: 'last-slot',
        };
      }
      return {
        cell: updateGroups([...groups, { items: [createSiteGroupEntry()] }]),
        changed: true,
      };
  }
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'week' || value === 'month' || value === 'year';
}

function isScheduleKind(value: unknown): value is ScheduleKind {
  return value === 'normal' || value === 'daily';
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseWeekHubCursorDate(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const date = new Date(`${value.trim()}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeWeekHubSelectedCellState(value: unknown): WeekHubSelectedCellState | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const userId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
  const day = typeof obj.day === 'string' ? obj.day.trim() : '';
  if (!userId || !day) return null;
  return { userId, day };
}

function normalizeWeekHubEditingCellState(value: unknown): WeekHubEditingCellState | null {
  const base = normalizeWeekHubSelectedCellState(value);
  if (!base || !value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const slotIndexRaw = obj.slotIndex;
  const slotIndex =
    typeof slotIndexRaw === 'number' && Number.isFinite(slotIndexRaw)
      ? Math.max(0, Math.trunc(slotIndexRaw))
      : 0;
  const targetItemIndexRaw = obj.targetItemIndex;
  const targetItemIndex =
    typeof targetItemIndexRaw === 'number' && Number.isFinite(targetItemIndexRaw)
      ? Math.max(0, Math.trunc(targetItemIndexRaw))
      : null;
  const source: WeekHubEditSource = obj.source === 'button' ? 'button' : 'direct';
  return { ...base, slotIndex, source, targetItemIndex };
}

function normalizeWeekHubHistoryState(raw: unknown): WeekHubHistoryState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!isViewMode(obj.mode) || !isScheduleKind(obj.scheduleKind) || !parseWeekHubCursorDate(obj.cursorDate)) {
    return null;
  }
  return {
    v: 1,
    mode: obj.mode,
    scheduleKind: obj.scheduleKind,
    cursorDate: String(obj.cursorDate),
    selectedUserId:
      typeof obj.selectedUserId === 'string' && obj.selectedUserId.trim().length > 0
        ? obj.selectedUserId.trim()
        : null,
    selectedCell: normalizeWeekHubSelectedCellState(obj.selectedCell),
    editingCell: normalizeWeekHubEditingCellState(obj.editingCell),
    editingInput: typeof obj.editingInput === 'string' ? obj.editingInput : '',
  };
}

function readWeekHubHistoryState(): WeekHubHistoryState | null {
  if (typeof window === 'undefined') return null;
  const rawState = window.history.state;
  if (!rawState || typeof rawState !== 'object') return null;
  const raw = (rawState as Record<string, unknown>)[WEEK_HUB_HISTORY_STATE_KEY];
  return normalizeWeekHubHistoryState(raw);
}

function formatHistoryDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatHistoryMonthDay(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}`;
}

function formatHistorySurname(value: string) {
  const normalized = value.replace(/[\s\u3000]+/g, ' ').trim();
  if (!normalized) return value.trim();
  if (normalized.includes('@')) return normalized.split('@')[0] ?? normalized;
  return normalized.split(' ')[0] ?? normalized;
}

function formatHistoryCellValue(value: string) {
  return value === '（空）' ? '空欄' : value;
}

function formatHistoryGroupValue(group: ApiCellGroup | null | undefined) {
  if (!group) return null;
  const labels = group.items
    .map((item) => {
      const label = item.label.trim();
      if (!label) return null;
      return normalizeScheduleCellEntryKind(item.kind) === 'note' ? `追記: ${label}` : label;
    })
    .filter((label): label is string => Boolean(label));
  return formatScheduleCellGroupDisplayValue(labels, group.note);
}

function formatHistoryGroupsValue(groups: ApiCellGroup[] | null | undefined, fallbackValue: string) {
  const parts = (groups ?? [])
    .map((group) => formatHistoryGroupValue(group))
    .filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' | ') : formatHistoryCellValue(fallbackValue);
}

function formatHistoryChange(
  beforeValue: string,
  afterValue: string,
  beforeGroups?: ApiCellGroup[] | null,
  afterGroups?: ApiCellGroup[] | null,
) {
  return `${formatHistoryGroupsValue(beforeGroups, beforeValue)} → ${formatHistoryGroupsValue(afterGroups, afterValue)}`;
}

function renderHistoryCellValue(value: string, groups?: ApiCellGroup[] | null): ReactNode {
  const normalizedGroups = (groups ?? [])
    .map((group) => ({
      items: group.items.filter((item) => item.label.trim().length > 0).slice(0, MAX_GROUP_ITEMS),
      note: normalizeScheduleCellNote(group.note),
    }))
    .filter((group) => group.items.length > 0)
    .slice(0, MAX_CELL_GROUPS);

  if (normalizedGroups.length === 0) return formatHistoryCellValue(value);

  return (
    <div className="space-y-1">
      {normalizedGroups.map((group, groupIndex) => {
        const noteOnly = group.items.every((item) => normalizeScheduleCellEntryKind(item.kind) === 'note');
        return (
          <div
            key={`history-group:${value}:${groupIndex}`}
            className={`rounded-md border px-2 py-1 ${
              noteOnly
                ? 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
                : 'border-zinc-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/40'
            }`}
          >
            <div className="whitespace-normal break-words leading-snug text-zinc-800 dark:text-zinc-200">
              {group.items.map((item, itemIndex) => {
                const kind = normalizeScheduleCellEntryKind(item.kind);
                return (
                  <Fragment key={`history-item:${value}:${groupIndex}:${itemIndex}`}>
                    {itemIndex > 0 ? <span className="text-zinc-400 dark:text-zinc-500"> / </span> : null}
                    {kind === 'note' ? (
                      <>
                        <span className="text-red-600 dark:text-red-400">追記:</span>{' '}
                        <span className="text-zinc-700 dark:text-zinc-200">{item.label}</span>
                      </>
                    ) : (
                      <span className={labelTextClass(item.color ?? 'default', itemIndex === 0 ? 'primary' : 'secondary')}>
                        {item.label}
                      </span>
                    )}
                  </Fragment>
                );
              })}
              {group.note ? (
                <>
                  {group.items.length > 0 ? <span className="text-zinc-400 dark:text-zinc-500">（</span> : null}
                  <span className="text-red-600 dark:text-red-400">追記:</span>{' '}
                  <span className="text-zinc-700 dark:text-zinc-200">{group.note}</span>
                  {group.items.length > 0 ? <span className="text-zinc-400 dark:text-zinc-500">）</span> : null}
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatCellSlotsValue(cell: ApiCell | null | undefined) {
  const groups = apiCellToGroups(cell);
  const parts = groups.map((group) => apiCellGroupValue(group)).filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' / ') : '空欄';
}

function startOfWeekMonday(input: Date) {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(input: Date, days: number) {
  const d = new Date(input);
  d.setDate(d.getDate() + days);
  return d;
}

function weekdayMon1Sun7FromYmd(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00`);
  const dow0Sun = d.getDay();
  return dow0Sun === 0 ? 7 : dow0Sun;
}

const DOW = ['月', '火', '水', '木', '金', '土', '日'] as const;

function depreciationBadgeClass(alert: boolean) {
  return `shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
    alert
      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200'
      : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
  }`;
}

function splitSiteLabel(label: string | null | undefined) {
  const value = (label ?? '').trim();
  if (!value) return { companyName: null, name: '' };
  const parts = value.split(' / ');
  if (parts.length >= 2) {
    return {
      companyName: parts.slice(0, -1).join(' / ').trim() || null,
      name: parts[parts.length - 1]?.trim() ?? '',
    };
  }
  return { companyName: null, name: value };
}

function siteStoredName(site: Pick<SiteItem, 'name' | 'label'> | null | undefined) {
  const name = site?.name?.trim();
  if (name) return name;
  return splitSiteLabel(site?.label).name;
}

function mergeSiteItems(
  current: SiteItem[],
  incoming: Array<Pick<SiteItem, 'id' | 'label' | 'name' | 'companyName' | 'scheduleLabelColor'>>,
): SiteItem[] {
  const byId = new Map(current.filter((item) => item.id).map((item) => [item.id as string, item] as const));
  const byLabel = new Map(current.map((item) => [item.label.trim(), item] as const));

  return incoming.map((item) => {
    const hit = (item.id ? byId.get(item.id) : undefined) ?? byLabel.get(item.label.trim());
    return hit
      ? {
          ...hit,
          id: item.id,
          label: item.label,
          name: item.name ?? hit.name ?? null,
          companyName: item.companyName ?? hit.companyName ?? null,
          scheduleLabelColor: item.scheduleLabelColor ?? hit.scheduleLabelColor ?? 'default',
        }
      : {
          id: item.id,
          label: item.label,
          name: item.name ?? null,
          companyName: item.companyName ?? null,
          scheduleLabelColor: item.scheduleLabelColor ?? 'default',
        };
  });
}

export default function WeekHub() {
  return (
    <Suspense fallback={null}>
      <WeekHubInner />
    </Suspense>
  );
}

function WeekHubInner() {
  const { setAddAction, setHistoryAction, setHistoryMenu, setHistoryPanel, setSaveAction, setUndoAction, setRedoAction } = useHeaderActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qsUserId = searchParams.get('userId');
  const qsMode = searchParams.get('mode');
  const qsKind = searchParams.get('kind');
  const [mode, setMode] = useState<ViewMode>(() => (isViewMode(qsMode) ? qsMode : 'week'));
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>(() => (typeof qsKind === 'string' && qsKind.toLowerCase() === 'daily' ? 'daily' : 'normal'));
  const [gridLayout, setGridLayout] = useState<GridLayout>('compact');
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [monthData, setMonthData] = useState<MonthApiResponse | null>(null);
  const [yearData, setYearData] = useState<YearSummaryApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isElectronShell, setIsElectronShell] = useState(false);
  const [editConfigured, setEditConfigured] = useState(false);
  const [editEnabled, setEditEnabled] = useState(true);
  const [editActive, setEditActive] = useState(false);
  const [authMeUser, setAuthMeUser] = useState<AuthMeUser | null>(null);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editPasswordMsg, setEditPasswordMsg] = useState<string | null>(null);
  const [historyHover, setHistoryHover] = useState<{ userId: string; day: string } | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);
  const [siteQuery, setSiteQuery] = useState('');
  const [siteQuickInput, setSiteQuickInput] = useState('');
  const [siteQuickMsg, setSiteQuickMsg] = useState<string | null>(null);
  const siteQuickInputRef = useRef<HTMLInputElement | null>(null);
  const pinSiteLabelRef = useRef<string | null>(null);
  const sitePaneScrollRef = useRef<HTMLDivElement | null>(null);
  const onSiteBannerWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = sitePaneScrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight) return;
    e.preventDefault();
    el.scrollTop += e.deltaY;
  }, []);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(() => ((qsUserId ?? '').trim() || null));
  const [nameColW, setNameColW] = useState<number>(DEFAULT_WEEK_GRID_PREFS.nameColW);
  // たたみ時のセル幅
  const [cellMinW, setCellMinW] = useState<number>(DEFAULT_WEEK_GRID_PREFS.cellMinW);
  const [cellMinHCompact, setCellMinHCompact] = useState<number>(DEFAULT_WEEK_GRID_PREFS.cellMinHCompact);
  const [cellMinHComfortable, setCellMinHComfortable] = useState<number>(DEFAULT_WEEK_GRID_PREFS.cellMinHComfortable);
  const [cellBg, setCellBg] = useState<CellBg>(DEFAULT_WEEK_GRID_PREFS.cellBg);
  const [cellClickAction, setCellClickAction] = useState<CellClickAction>('toggle');
  const [isColorEditMode, setIsColorEditMode] = useState(false);
  const [cellTextColor, setCellTextColor] = useState<CellTextColor>(DEFAULT_WEEK_GRID_PREFS.cellTextColor);
  const [cellActionMsg, setCellActionMsg] = useState<string | null>(null);
  const cellActionMsgTimer = useRef<number | null>(null);
  const lastNonColorCellActionRef = useRef<CellClickAction>('toggle');
  const [isNameColResizing, setIsNameColResizing] = useState(false);
  const nameColResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const [effectiveUserId, setEffectiveUserId] = useState<string | null>(null);
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const userOrderLoadedScopeRef = useRef<string | null>(null);
  const userOrderSavingRef = useRef(false);
  const userOrderSavePromiseRef = useRef<Promise<void> | null>(null);
  const pendingUserOrderRef = useRef<string[] | null>(null);
  const userOrderLoadRequestRef = useRef(0);
  const userOrderLocalRevisionRef = useRef(0);
  const effectiveUserIdRef = useRef<string | null>(null);
  const userOrderRef = useRef<string[]>([]);
  const [reorderMode, setReorderMode] = useState(false);

  const [undoStack, setUndoStack] = useState<CellHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<CellHistoryEntry[]>([]);
  const [isUndoRedoBusy, setIsUndoRedoBusy] = useState(false);

  const [selectedCell, setSelectedCell] = useState<WeekHubSelectedCellState | null>(null);
  const [draggedSite, setDraggedSite] = useState<SiteItem | null>(null);
  const [draggedCell, setDraggedCell] = useState<DraggedCellState | null>(null);
  const [editingCell, setEditingCell] = useState<WeekHubEditingCellState | null>(null);
  const [editingInput, setEditingInput] = useState('');
  const [siteSuggestions, setSiteSuggestions] = useState<SiteItem[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [scheduleHistoryItems, setScheduleHistoryItems] = useState<ScheduleChangeHistoryItem[]>([]);
  const [scheduleHistoryTotal, setScheduleHistoryTotal] = useState(0);
  const [scheduleHistoryLoading, setScheduleHistoryLoading] = useState(false);
  const [scheduleHistoryError, setScheduleHistoryError] = useState<string | null>(null);
  const [scheduleHistoryLoadedKind, setScheduleHistoryLoadedKind] = useState<'NORMAL' | 'DAILY' | null>(null);
  const [scheduleHistorySearch, setScheduleHistorySearch] = useState('');
  const [scheduleHistoryTargetFilter, setScheduleHistoryTargetFilter] = useState<'all' | 'スケジュール' | 'カラー'>('all');
  const skipInitialModeSyncRef = useRef(false);
  const skipInitialKindSyncRef = useRef(false);
  const skipInitialUserSyncRef = useRef(false);
  const didInitialHistoryRestoreRef = useRef(false);

  useEffect(() => {
    if (didInitialHistoryRestoreRef.current) return;
    didInitialHistoryRestoreRef.current = true;
    const currentDesktopHref = (() => {
      const qs = searchParams.toString();
      return qs ? `/?${qs}` : '/';
    })();
    const skipStoredDesktopRestore = consumeForceDesktopWeekHomeOnce();
    const storedDesktopState = (() => {
      if (skipStoredDesktopRestore) return null;
      const stored = readStoredScheduleReturn();
      if (!stored || stored.target !== 'desktop-week-hub' || stored.href !== currentDesktopHref) return null;
      return normalizeWeekHubHistoryState(stored.state);
    })();
    const restoredState = readWeekHubHistoryState() ?? storedDesktopState;
    if (!restoredState) return;

    skipInitialModeSyncRef.current = true;
    skipInitialKindSyncRef.current = true;
    skipInitialUserSyncRef.current = true;
    setMode(restoredState.mode);
    setScheduleKind(restoredState.scheduleKind);
    setCursorDate(parseWeekHubCursorDate(restoredState.cursorDate) ?? new Date());
    setSelectedUserId(restoredState.selectedUserId ?? null);
    setSelectedCell(restoredState.selectedCell ?? null);
    setEditingCell(restoredState.editingCell ?? null);
    setEditingInput(restoredState.editingInput ?? '');
  }, [searchParams]);

  useEffect(() => {
    if (skipInitialModeSyncRef.current) {
      skipInitialModeSyncRef.current = false;
      return;
    }
    if (isViewMode(qsMode)) {
      setMode(qsMode);
    }
  }, [qsMode]);

  const stopNameColResize = useCallback(() => {
    nameColResizeRef.current = null;
    setIsNameColResizing(false);
  }, []);

  const startNameColResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      nameColResizeRef.current = {
        startX: event.clientX,
        startWidth: nameColW,
      };
      setIsNameColResizing(true);
    },
    [nameColW],
  );

  useEffect(() => {
    if (!isNameColResizing) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onPointerMove = (event: PointerEvent) => {
      const current = nameColResizeRef.current;
      if (!current) return;
      const next = clampNameColumnWidth(current.startWidth + event.clientX - current.startX);
      setNameColW((prev) => (prev === next ? prev : next));
    };

    const onPointerUp = () => {
      stopNameColResize();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isNameColResizing, stopNameColResize]);

  useEffect(() => {
    if (skipInitialKindSyncRef.current) {
      skipInitialKindSyncRef.current = false;
      return;
    }
    if (typeof qsKind !== 'string') return;
    setScheduleKind(qsKind.toLowerCase() === 'daily' ? 'daily' : 'normal');
  }, [qsKind]);

  useEffect(() => {
    if (skipInitialUserSyncRef.current) {
      skipInitialUserSyncRef.current = false;
      return;
    }
    const next = (qsUserId ?? '').trim();
    if (!next) return;
    setSelectedUserId((current) => (current === next ? current : next));
  }, [qsUserId]);

  useEffect(() => {
    const l = (searchParams.get('layout') ?? '').toLowerCase();
    setGridLayout(l === 'comfortable' ? 'comfortable' : 'compact');
  }, [searchParams]);

  const apiKind = useMemo(() => (scheduleKind === 'daily' ? 'DAILY' : 'NORMAL'), [scheduleKind]);
  const kindQuery = useMemo(() => `kind=${encodeURIComponent(scheduleKind)}`, [scheduleKind]);
  const hasScheduleEditPermission = !!(authMeUser?.canEditSchedule || authMeUser?.canGrantScheduleEdit);
  const currentEditorLabel = authMeUser?.name ?? authMeUser?.email ?? '管理者';

  const gridPrefsKey = useMemo(() => {
    return `week-hub:${scheduleKind}:${mode}:gridPrefs`;
  }, [mode, scheduleKind]);

  const userOrderKey = useMemo(() => {
    return `week-hub:${scheduleKind}:userOrder`;
  }, [scheduleKind]);

  const currentUserOrderScope = effectiveUserId ? `${effectiveUserId}:${userOrderKey}` : null;

  const commitLocalUserOrder = useCallback((update: string[] | ((current: string[]) => string[])) => {
    const current = userOrderRef.current;
    const next = typeof update === 'function' ? (update as (current: string[]) => string[])(current) : update;
    if (arrayEqual(next, current)) return null;
    userOrderLocalRevisionRef.current += 1;
    userOrderRef.current = next;
    setUserOrder(next);
    return next;
  }, []);

  useEffect(() => {
    effectiveUserIdRef.current = effectiveUserId;
  }, [effectiveUserId]);

  useEffect(() => {
    userOrderRef.current = userOrder;
  }, [userOrder]);

  const resolveUserOrderOwnerId = useCallback(() => {
    const viewerUserId = (authMeUser?.id ?? '').trim();
    if (viewerUserId) return viewerUserId;

    const q = (qsUserId ?? '').trim();
    if (q) return q;

    return effectiveUserIdRef.current;
  }, [authMeUser?.id, qsUserId]);

  const resolveEffectiveUserId = useCallback(async () => {
    const viewerUserId = (authMeUser?.id ?? '').trim();
    if (viewerUserId) {
      effectiveUserIdRef.current = viewerUserId;
      setEffectiveUserId(viewerUserId);
      return viewerUserId;
    }

    const q = (qsUserId ?? '').trim();
    if (q) {
      effectiveUserIdRef.current = q;
      setEffectiveUserId(q);
      return q;
    }

    const firstVisibleUserId =
      (mode === 'week'
        ? data?.users?.[0]?.id
        : mode === 'month'
          ? monthData?.users?.[0]?.id
          : yearData?.users?.[0]?.id) ?? null;

    effectiveUserIdRef.current = firstVisibleUserId;
    setEffectiveUserId(firstVisibleUserId);
    return firstVisibleUserId;
  }, [authMeUser?.id, data?.users, mode, monthData?.users, qsUserId, yearData?.users]);

  const loadUserOrder = useCallback(
    async (userId: string | null) => {
      if (!userId) return;
      const scope = `${userId}:${userOrderKey}`;
      if (userOrderLoadedScopeRef.current === scope) return;
      const requestId = ++userOrderLoadRequestRef.current;
      const localRevisionAtStart = userOrderLocalRevisionRef.current;

      try {
        const r = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(userOrderKey)}`,
          { cache: 'no-store' },
        );
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) return;

        const raw = obj.value;
        const arr = Array.isArray(raw) ? (raw as unknown[]) : [];
        const parsed = arr
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
          .slice(0, 1000);
        if (userOrderLoadRequestRef.current !== requestId) return;
        if (userOrderLocalRevisionRef.current !== localRevisionAtStart) return;
        if (!arrayEqual(userOrderRef.current, parsed)) {
          userOrderRef.current = parsed;
          setUserOrder(parsed);
        }
      } catch {
        // ignore
      } finally {
        if (userOrderLoadRequestRef.current === requestId) {
          userOrderLoadedScopeRef.current = scope;
        }
      }
    },
    [userOrderKey],
  );

  const gridPrefsLoadedRef = useRef<Record<string, true>>({});
  const gridPrefsSaveTimerRef = useRef<number | null>(null);

  const readLocalGridPrefs = useCallback((key: string) => {
    if (typeof window === 'undefined') return null;
    try {
      const txt = window.localStorage.getItem(`masterHub.ui:${key}`);
      if (!txt) return null;
      return JSON.parse(txt) as unknown;
    } catch {
      return null;
    }
  }, []);

  const applyGridPrefs = useCallback((raw: unknown) => {
    const next = normalizeWeekGridPrefs(raw);
    setGridLayout(next.gridLayout);
    setCellTextColor(next.cellTextColor);
    setCellBg(next.cellBg);
    setNameColW(next.nameColW);
    setCellMinW(next.cellMinW);
    setCellMinHCompact(next.cellMinHCompact);
    setCellMinHComfortable(next.cellMinHComfortable);
  }, []);

  const loadGridPrefs = useCallback(async (userId: string | null, key: string) => {
    if (gridPrefsLoadedRef.current[key]) return;
    gridPrefsLoadedRef.current[key] = true;

    const localRaw = readLocalGridPrefs(key);
    if (localRaw) applyGridPrefs(localRaw);

    if (!userId) return;

    try {
      const r = await fetch(`/api/ui-settings?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(key)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) return;

      const raw = obj.value;
      const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      if (!o) return;

      applyGridPrefs(o);

      const nextAction =
        o.cellClickAction === 'toggle' ||
        o.cellClickAction === 'add' ||
        o.cellClickAction === 'remove' ||
        o.cellClickAction === 'replace2' ||
        o.cellClickAction === 'swap' ||
        o.cellClickAction === 'recolor'
          ? (o.cellClickAction as CellClickAction)
          : null;
      if (nextAction) setCellClickAction(nextAction);

      if (typeof window !== 'undefined') {
        try {
          const normalized = normalizeWeekGridPrefs(o);
          window.localStorage.setItem(
            `masterHub.ui:${key}`,
            JSON.stringify({ ...o, ...normalized, v: WEEK_GRID_PREFS_VERSION }),
          );
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }, [applyGridPrefs, readLocalGridPrefs]);

  const saveGridPrefs = useCallback(async (userId: string | null, key: string, value: unknown) => {
    const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const normalized = normalizeWeekGridPrefs(value);
    const payload = { ...raw, ...normalized, v: WEEK_GRID_PREFS_VERSION };

    if (typeof window !== 'undefined') {
      try {
        const localKey = `masterHub.ui:${key}`;
        const nextTxt = JSON.stringify(payload);
        const prevTxt = window.localStorage.getItem(localKey);
        if (prevTxt !== nextTxt) {
          window.localStorage.setItem(localKey, nextTxt);
          window.dispatchEvent(new CustomEvent('masterHub:gridPrefsUpdated', { detail: { key } }));
        }
      } catch {
        // ignore
      }
    }

    if (!userId) return;
    try {
      await fetch('/api/ui-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, key, value: payload }),
      });
    } catch {
      // ignore
    }
  }, []);

  const saveUserOrder = useCallback(
    async (userId: string | null, next: string[]) => {
      const ownerUserId = (userId ?? '').trim() || resolveUserOrderOwnerId();
      if (!ownerUserId) return;
      pendingUserOrderRef.current = next;
      if (userOrderSavingRef.current) {
        return userOrderSavePromiseRef.current ?? Promise.resolve();
      }

      userOrderSavingRef.current = true;
      const task = (async () => {
        try {
          while (pendingUserOrderRef.current) {
            const v = pendingUserOrderRef.current;
            pendingUserOrderRef.current = null;
            await fetch('/api/ui-settings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ userId: ownerUserId, key: userOrderKey, value: v }),
            });
          }
        } finally {
          userOrderSavingRef.current = false;
          userOrderSavePromiseRef.current = null;
        }
      })();

      userOrderSavePromiseRef.current = task;
      return task;
    },
    [resolveUserOrderOwnerId, userOrderKey],
  );

  const flushUserOrderSave = useCallback(async () => {
    if (!reorderMode && !pendingUserOrderRef.current && !userOrderSavingRef.current) return;
    await saveUserOrder(effectiveUserIdRef.current, userOrderRef.current);
  }, [reorderMode, saveUserOrder]);

  const persistUserOrderChange = useCallback(
    (update: string[] | ((current: string[]) => string[])) => {
      const next = commitLocalUserOrder(update);
      if (!next) return null;
      void saveUserOrder(effectiveUserIdRef.current, next);
      return next;
    },
    [commitLocalUserOrder, saveUserOrder],
  );

  useEffect(() => {
    userOrderLoadedScopeRef.current = null;
    userOrderLoadRequestRef.current += 1;
  }, [userOrderKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof navigator === 'undefined') return;

    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const userAgent = navigator.userAgent;
    const isWorkbenchShell = /\bCode\/\d+/i.test(userAgent);
    setIsElectronShell(/\bElectron\/\d+/i.test(userAgent) && !isWorkbenchShell);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as unknown;
        const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!mounted || o?.ok !== true) return;
        const editMode = o.editMode && typeof o.editMode === 'object' ? (o.editMode as Record<string, unknown>) : null;
        setEditConfigured(editMode?.configured === true);
        setEditEnabled(editMode ? editMode.enabled === true : true);
        const raw = o.user && typeof o.user === 'object' ? (o.user as Record<string, unknown>) : null;
        if (!raw || typeof raw.id !== 'string') {
          setAuthMeUser(null);
          return;
        }
        setAuthMeUser({
          id: raw.id,
          name: typeof raw.name === 'string' ? raw.name : null,
          email: typeof raw.email === 'string' ? raw.email : null,
          canEditSchedule: raw.canEditSchedule === true,
          canGrantScheduleEdit: raw.canGrantScheduleEdit === true,
        });
      })
      .catch(() => {
        if (mounted) setAuthMeUser(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const uid = await resolveEffectiveUserId();
      if (!mounted) return;
      await loadUserOrder(uid);
      await loadGridPrefs(uid, gridPrefsKey);
    })();
    return () => {
      mounted = false;
    };
  }, [gridPrefsKey, loadGridPrefs, loadUserOrder, resolveEffectiveUserId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const apply = (event?: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key && event.key !== `masterHub.ui:${gridPrefsKey}`) return;
      }

      if (event instanceof CustomEvent) {
        const detail = event.detail && typeof event.detail === 'object' ? (event.detail as Record<string, unknown>) : null;
        if (typeof detail?.key === 'string' && detail.key !== gridPrefsKey) return;
      }

      const raw = readLocalGridPrefs(gridPrefsKey);
      if (raw) applyGridPrefs(raw);
    };

    window.addEventListener('masterHub:gridPrefsUpdated', apply as EventListener);
    window.addEventListener('storage', apply as EventListener);
    return () => {
      window.removeEventListener('masterHub:gridPrefsUpdated', apply as EventListener);
      window.removeEventListener('storage', apply as EventListener);
    };
  }, [applyGridPrefs, gridPrefsKey, readLocalGridPrefs]);

  useEffect(() => {
    if (!gridPrefsLoadedRef.current[gridPrefsKey]) return;
    if (typeof window === 'undefined') return;

    if (gridPrefsSaveTimerRef.current) {
      window.clearTimeout(gridPrefsSaveTimerRef.current);
      gridPrefsSaveTimerRef.current = null;
    }

    const payload = {
      gridLayout,
      cellClickAction,
      cellTextColor,
      cellBg,
      nameColW,
      cellMinW,
      cellMinHCompact,
      cellMinHComfortable,
    };

    gridPrefsSaveTimerRef.current = window.setTimeout(() => {
      gridPrefsSaveTimerRef.current = null;
      void saveGridPrefs(effectiveUserId, gridPrefsKey, payload);
    }, 350);

    return () => {
      if (gridPrefsSaveTimerRef.current) {
        window.clearTimeout(gridPrefsSaveTimerRef.current);
        gridPrefsSaveTimerRef.current = null;
      }
    };
  }, [
    cellBg,
    cellClickAction,
    cellMinHCompact,
    cellMinHComfortable,
    cellMinW,
    cellTextColor,
    effectiveUserId,
    gridLayout,
    gridPrefsKey,
    nameColW,
    saveGridPrefs,
  ]);

  useEffect(() => {
    try {
      const key = 'masterHub.lastSelectedSiteLabel';
      if (selectedSite?.label) {
        window.localStorage.setItem(key, selectedSite.label);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }, [selectedSite?.label]);

  useEffect(() => {
    if (!selectedSite?.label) return;
    setSiteQuickInput((cur) => (cur.trim() ? cur : selectedSite.label));
  }, [selectedSite?.label]);

  const normalizeSiteInputToName = useCallback((raw: string) => {
    const s = raw.trim();
    if (!s) return '';
    return s.includes(' / ') ? s.split(' / ').slice(-1)[0]!.trim() : s;
  }, []);

  const resolveSiteFromText = useCallback(
    (raw: string): SiteItem | null => {
      const s = raw.trim();
      if (!s) return null;

      const exact = sites.find((x) => x.label.trim() === s);
      if (exact) return exact;

      const suffix = ` / ${s}`;
      const bySuffix = sites.find((x) => x.label.trim().endsWith(suffix));
      if (bySuffix) return bySuffix;

      const name = normalizeSiteInputToName(s);
      if (!name) return null;

      const byName = sites.find((x) => x.label.trim() === name || x.label.trim().endsWith(` / ${name}`));
      if (byName) return byName;

      return { id: null, label: name, name, companyName: null };
    },
    [normalizeSiteInputToName, sites],
  );

  const resolveSiteReference = useCallback(
    (input: { siteId?: string | null; siteName?: string | null }): SiteItem | null => {
      const siteId = input.siteId?.trim();
      if (siteId) {
        const byId = sites.find((site) => site.id === siteId);
        if (byId) return byId;
      }

      const siteName = input.siteName?.trim();
      if (!siteName) return null;
      return resolveSiteFromText(siteName);
    },
    [resolveSiteFromText, sites],
  );

  const pinSiteToTop = useCallback(
    (site: SiteItem) => {
    const label = (site?.label ?? '').trim();
    if (!label) return;

    // Keep the last pinned label so refreshSites() (which replaces sites) can re-pin.
    pinSiteLabelRef.current = label;

    setSites((cur) => {
      const idx = cur.findIndex((x) => x.label.trim() === label);
      const hit = idx >= 0 ? cur[idx]! : site;
      return idx >= 0 ? [hit, ...cur.slice(0, idx), ...cur.slice(idx + 1)] : [hit, ...cur];
    });
    setSelectedSite((cur) => {
      if (!cur) return cur;
      if (cur.label.trim() !== label) return cur;
      const upgraded = sites.find((x) => x.label.trim() === label);
      return upgraded?.id ? upgraded : cur;
    });
    },
    [sites],
  );

  const pickSiteFromInput = useCallback(async () => {
    setSiteQuickMsg(null);
    const item = resolveSiteFromText(siteQuickInput);
    if (!item) {
      setSiteQuickMsg('現場名を入力してください');
      return null;
    }
    setSelectedSite(item);
    setSiteQuickInput(item.label);
    setSiteQuery('');
    pinSiteLabelRef.current = item.label;
    pinSiteToTop(item);
    return item;
  }, [pinSiteToTop, resolveSiteFromText, siteQuickInput]);

  useEffect(() => {
    const label = pinSiteLabelRef.current;
    if (!label) return;
    // If refreshSites() replaced the list, keep the pinned item at the top.
    if (sites.length > 0 && sites[0]?.label?.trim() === label.trim()) return;
    pinSiteToTop({ id: null, label });
  }, [pinSiteToTop, sites]);

  const normalizedSiteQuery = useMemo(() => siteQuery.trim().toLowerCase(), [siteQuery]);
  const normalizedQuickSiteFilterQuery = useMemo(() => {
    const quick = siteQuickInput.trim().toLowerCase();
    const selectedLabel = (selectedSite?.label ?? '').trim().toLowerCase();
    if (!quick) return '';
    return quick === selectedLabel ? '' : quick;
  }, [selectedSite?.label, siteQuickInput]);
  const effectiveSiteFilterQuery = normalizedSiteQuery || normalizedQuickSiteFilterQuery;
  const hasSiteQuery = effectiveSiteFilterQuery.length > 0;

  const visibleSites = useMemo(() => {
    return sites.filter((s) => {
      if (s.badgeMonthVisible === false) return false;
      if (!effectiveSiteFilterQuery) return true;
      return s.label.toLowerCase().includes(effectiveSiteFilterQuery);
    });
  }, [effectiveSiteFilterQuery, sites]);

  const handleSiteQueryInput = useCallback((event: FormEvent<HTMLInputElement>) => {
    setSiteQuery(event.currentTarget.value);
  }, []);

  const handleSiteQuickInput = useCallback((event: FormEvent<HTMLInputElement>) => {
    setSiteQuickInput(event.currentTarget.value);
    setSiteQuickMsg(null);
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams({ kind: scheduleKind });
    if (selectedUserId) sp.set('userId', selectedUserId);
    const qs = sp.toString();
    for (const site of visibleSites.slice(0, 12)) {
      if (!site.id) continue;
      router.prefetch(`/site-ledger/${encodeURIComponent(site.id)}?${qs}`);
    }
  }, [router, scheduleKind, selectedUserId, visibleSites]);

  const showCellActionMsg = useCallback((msg: string | null) => {
    if (cellActionMsgTimer.current) {
      window.clearTimeout(cellActionMsgTimer.current);
      cellActionMsgTimer.current = null;
    }
    setCellActionMsg(msg);
    if (msg) {
      cellActionMsgTimer.current = window.setTimeout(() => {
        setCellActionMsg(null);
        cellActionMsgTimer.current = null;
      }, 2500);
    }
  }, []);

  const ensureSelectedSite = useCallback(async (): Promise<SiteItem | null> => {
    if (selectedSite) return selectedSite;
    const picked = await pickSiteFromInput();
    if (picked) return picked;

    try {
      siteQuickInputRef.current?.focus();
      siteQuickInputRef.current?.select();
    } catch {
      // ignore
    }
    showCellActionMsg('現場を選択するか、左の入力欄に現場名を入れて「選択」してください');
    return null;
  }, [pickSiteFromInput, selectedSite, showCellActionMsg]);

  const setColorEditMode = useCallback((next: boolean) => {
    writeColorEditMode(next);
    setIsColorEditMode(next);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const apply = () => {
      setIsColorEditMode(readColorEditMode());
    };

    apply();
    window.addEventListener('masterHub:colorEditModeUpdated', apply as EventListener);
    window.addEventListener('storage', apply);
    return () => {
      window.removeEventListener('masterHub:colorEditModeUpdated', apply as EventListener);
      window.removeEventListener('storage', apply);
    };
  }, []);

  useEffect(() => {
    if (cellClickAction === 'recolor') return;
    lastNonColorCellActionRef.current = cellClickAction;
  }, [cellClickAction]);

  const cellActionButtons = hasScheduleEditPermission ? (
    <div className="ml-1 flex items-center gap-1">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">セル操作</span>
      <div className="flex max-w-[60vw] items-center gap-1 overflow-x-auto">
        {(
          [
            {
              value: 'toggle' as const,
              label: 'トグル',
              title: '選択現場があれば削除 / なければ追加（満杯なら変更なし）',
            },
            { value: 'add' as const, label: '追加', title: '空きがある時だけ追加（満杯なら変更なし）' },
            { value: 'replace2' as const, label: '末尾置換', title: '末尾枠を置換（空きなら追加）' },
            { value: 'remove' as const, label: '削除', title: '選択現場を削除（無ければ変更なし）' },
            { value: 'recolor' as const, label: '色', title: '選択現場の文字色を変更（追加/削除なし）' },
            { value: 'swap' as const, label: '入替', title: '1枠目と2枠目を入替（現場選択なしでOK）' },
          ] satisfies Array<{ value: CellClickAction; label: string; title: string }>
        ).map((a) => {
          const isColorAction = a.value === 'recolor';
          const active = isColorAction ? isColorEditMode : cellClickAction === a.value;
          const buttonTitle = isColorAction
            ? isColorEditMode
              ? '色編集を終了'
              : '右クリックで各ボタンや枠の色を編集'
            : a.title;
          return (
            <button
              key={a.value}
              type="button"
              onClick={() => {
                if (isColorAction) {
                  if (!editActive) {
                    showCellActionMsg('編集するには、ヘッダーの「編集」から開始してください');
                    return;
                  }
                  if (isColorEditMode) {
                    setColorEditMode(false);
                    setCellClickAction(lastNonColorCellActionRef.current);
                    return;
                  }
                  setCellClickAction('recolor');
                  setColorEditMode(true);
                  return;
                }
                if (isColorEditMode) {
                  setColorEditMode(false);
                }
                setCellClickAction(a.value);
              }}
              aria-pressed={active}
              title={buttonTitle}
              data-testid={`cell-action-${a.value}`}
              className={`shrink-0 rounded-md border px-2 py-1 text-[11px] tabular-nums ${
                active
                  ? 'border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-black dark:text-zinc-200'
                  : 'border-zinc-200 bg-white/60 text-zinc-600 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-300 dark:hover:bg-black'
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;
  const modeTabsRef = useRef<HTMLDivElement | null>(null);
  const [selectedSiteCreatedAt, setSelectedSiteCreatedAt] = useState<string | null>(null);
  const [newSiteName, setNewSiteName] = useState('');
  const [siteCreateMsg, setSiteCreateMsg] = useState<string | null>(null);
  const [repeatRule, setRepeatRule] = useState<RepeatRule>({
    intervalMonths: 1,
    weekdays: [],
    monthDays: [],
    monthsOfYear: [],
  });
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [autoFillMonth, setAutoFillMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  });
  const [contactNameInput, setContactNameInput] = useState('');
  const [contactSaveMsg, setContactSaveMsg] = useState<string | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);

  const [siteDetailOpen, setSiteDetailOpen] = useState(false);
  const [deprMonthByKind, setDeprMonthByKind] = useState<Record<ScheduleKind, string>>(() => {
    const now = new Date();
    const initialMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    return { normal: initialMonth, daily: initialMonth };
  });
  const deprMonth = deprMonthByKind[scheduleKind];
  const [deprState, setDeprState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ok'; count: number; threshold: number; alert: boolean }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  const [siteDeprMap, setSiteDeprMap] = useState<
    Record<string, { count: number; threshold: number; alert: boolean }>
  >({});
  const [deprThresholdInput, setDeprThresholdInput] = useState<string>('10');
  const [deprSaveMsg, setDeprSaveMsg] = useState<string | null>(null);
  const [autoFillResult, setAutoFillResult] = useState<
    | {
        ok: true;
        created: number;
        skipped: number;
        reason?: string;
      }
    | { ok: false; error: string }
    | null
  >(null);

  const setDeprMonthForCurrentKind = useCallback(
    (nextMonth: string) => {
      setDeprMonthByKind((prev) => {
        if (prev[scheduleKind] === nextMonth) return prev;
        return { ...prev, [scheduleKind]: nextMonth };
      });
    },
    [scheduleKind],
  );

  const weekStart = useMemo(() => {
    return startOfWeekMonday(cursorDate);
  }, [cursorDate]);

  const historyScopeKey = useMemo(() => {
    if (mode === 'week') return `week:${toYmd(weekStart)}`;
    if (mode === 'month') return `month:${cursorDate.getFullYear()}-${pad2(cursorDate.getMonth() + 1)}`;
    return `year:${cursorDate.getFullYear()}`;
  }, [cursorDate, mode, weekStart]);

  const historySnapshotJsonRef = useRef<string | null>(null);
  const writeWeekHubHistorySnapshot = useCallback((overrides?: Partial<WeekHubHistoryState>) => {
    if (typeof window === 'undefined') return;
    const snapshot: WeekHubHistoryState = {
      v: 1,
      mode: overrides?.mode ?? mode,
      scheduleKind: overrides?.scheduleKind ?? scheduleKind,
      cursorDate: overrides?.cursorDate ?? toYmd(cursorDate),
      selectedUserId:
        overrides && 'selectedUserId' in overrides
          ? overrides.selectedUserId ?? null
          : selectedUserId,
      selectedCell:
        overrides && 'selectedCell' in overrides
          ? overrides.selectedCell ?? null
          : selectedCell,
      editingCell:
        overrides && 'editingCell' in overrides
          ? overrides.editingCell ?? null
          : editingCell,
      editingInput:
        overrides && 'editingInput' in overrides
          ? overrides.editingInput ?? ''
          : editingInput,
    };
    const nextJson = JSON.stringify(snapshot);
    if (historySnapshotJsonRef.current === nextJson) return;
    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as Record<string, unknown>)
        : {};
    try {
      window.history.replaceState({ ...currentState, [WEEK_HUB_HISTORY_STATE_KEY]: snapshot }, '', window.location.href);
      writeStoredScheduleReturn({
        target: 'desktop-week-hub',
        href: getCurrentPathWithSearch(),
        state: snapshot,
      });
      historySnapshotJsonRef.current = nextJson;
    } catch {
      // ignore
    }
  }, [cursorDate, editingCell, editingInput, mode, scheduleKind, selectedCell, selectedUserId]);

  useEffect(() => {
    writeWeekHubHistorySnapshot();
  }, [writeWeekHubHistorySnapshot]);

  const openSiteDetailFromCell = useCallback(
    (siteName: string, focusCell?: WeekHubEditingCellState | null) => {
      const site = resolveSiteFromText(siteName);
      if (!site?.id) {
        showCellActionMsg('該当する現場詳細を開けませんでした');
        return;
      }
      if (focusCell) {
        writeWeekHubHistorySnapshot({
          selectedCell: { userId: focusCell.userId, day: focusCell.day },
        });
      } else {
        writeWeekHubHistorySnapshot();
      }
      const sp = new URLSearchParams({ kind: scheduleKind });
      if (selectedUserId) sp.set('userId', selectedUserId);
      router.push(`/site-ledger/${encodeURIComponent(site.id)}?${sp.toString()}#punch`);
    },
    [resolveSiteFromText, router, scheduleKind, selectedUserId, showCellActionMsg, writeWeekHubHistorySnapshot],
  );

  const openDailySiteRegistration = useCallback(() => {
    if (!hasScheduleEditPermission) {
      showCellActionMsg('日常現場登録は編集権限が必要です');
      return;
    }
    writeWeekHubHistorySnapshot();
    router.push('/management?kind=daily&open=daily-site');
  }, [hasScheduleEditPermission, router, showCellActionMsg, writeWeekHubHistorySnapshot]);

  useEffect(() => {
    // Keep Undo/Redo local to the current view scope.
    setUndoStack([]);
    setRedoStack([]);
  }, [historyScopeKey]);

  const restoreFocusCell = editingCell ?? selectedCell;

  useEffect(() => {
    const onJumpCurrentWeek = () => {
      consumeForceDesktopWeekHomeOnce();
      setMode('week');
      setScheduleKind('normal');
      setCursorDate(new Date());
      setSelectedUserId(null);
      setSelectedCell(null);
      setEditingCell(null);
      setEditingInput('');
      setSiteSuggestions([]);
    };

    window.addEventListener('masterHub:jumpCurrentWeek', onJumpCurrentWeek as EventListener);
    return () => window.removeEventListener('masterHub:jumpCurrentWeek', onJumpCurrentWeek as EventListener);
  }, []);

  useEffect(() => {
    if (!restoreFocusCell || mode === 'year') return;
    if (typeof window === 'undefined') return;

    const handle = window.requestAnimationFrame(() => {
      const target = document.querySelector(`[data-testid="cell-${restoreFocusCell.userId}-${restoreFocusCell.day}"]`);
      if (!(target instanceof HTMLElement)) return;
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (!editingCell) return;
      const input = target.querySelector('input[type="text"]');
      if (!(input instanceof HTMLInputElement)) return;
      input.focus({ preventScroll: true });
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    });

    return () => window.cancelAnimationFrame(handle);
  }, [data, editingCell, mode, monthData, restoreFocusCell, yearData]);

  const selectedUserLabel = useMemo(() => {
    if (!selectedUserId) return null;
    const pools: ApiUser[] = [
      ...(data?.users ?? []),
      ...(monthData?.users ?? []),
      ...(yearData?.users ?? []),
    ];
    const hit = pools.find((u) => u.id === selectedUserId);
    return hit ? hit.name ?? hit.email ?? hit.id : selectedUserId;
  }, [data?.users, monthData?.users, selectedUserId, yearData?.users]);

  const visibleWeekDays = useMemo(() => {
    return new Set(Array.from({ length: 7 }, (_, index) => toYmd(addDays(weekStart, index))));
  }, [weekStart]);

  const updateVisibleCell = useCallback((input: { userId: string; day: string; cell: ApiCell }) => {
    setData((current) => {
      if (!current || !visibleWeekDays.has(input.day)) return current;
      const prevCell = current.grid[input.userId]?.[input.day];
      if (apiCellsEqual(prevCell, input.cell)) return current;
      return {
        ...current,
        grid: {
          ...current.grid,
          [input.userId]: {
            ...(current.grid[input.userId] ?? {}),
            [input.day]: cloneApiCell(input.cell),
          },
        },
      };
    });

    setMonthData((current) => {
      if (!current || !current.days.includes(input.day)) return current;
      const prevCell = current.grid[input.userId]?.[input.day];
      if (apiCellsEqual(prevCell, input.cell)) return current;
      return {
        ...current,
        grid: {
          ...current.grid,
          [input.userId]: {
            ...(current.grid[input.userId] ?? {}),
            [input.day]: cloneApiCell(input.cell),
          },
        },
      };
    });
  }, [visibleWeekDays]);

  const loadScheduleHistory = useCallback(async () => {
    const requestKind = apiKind;
    setScheduleHistoryLoading(true);
    setScheduleHistoryError(null);
    try {
      const res = await fetch(`/api/schedule/history?kind=${encodeURIComponent(requestKind)}&limit=5000`, {
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; total: number; items: ScheduleChangeHistoryItem[] }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || !('ok' in json) || json.ok !== true) {
        setScheduleHistoryError(json && 'error' in json ? json.error ?? '履歴の取得に失敗しました' : `HTTP ${res.status}`);
        return;
      }
      setScheduleHistoryItems(Array.isArray(json.items) ? json.items : []);
      setScheduleHistoryTotal(typeof json.total === 'number' ? json.total : 0);
    } catch {
      setScheduleHistoryError('履歴の取得に失敗しました');
    } finally {
      setScheduleHistoryLoadedKind(requestKind);
      setScheduleHistoryLoading(false);
    }
  }, [apiKind]);

  const isScheduleHistoryLoaded = scheduleHistoryLoadedKind === apiKind;

  const historyPreviewItems = useMemo(
    () =>
      isScheduleHistoryLoaded
        ? scheduleHistoryItems.slice(0, 12).map((item) => ({
            key: item.id,
            at: Number.isNaN(Date.parse(item.createdAt)) ? Date.now() : Date.parse(item.createdAt),
            targetLabel: `${formatHistoryMonthDay(item.dayYmd)} ${formatHistorySurname(item.targetUserLabel)}`,
            beforeLabel: formatHistoryGroupsValue(item.beforeGroups, item.beforeValue),
            afterLabel: formatHistoryGroupsValue(item.afterGroups, item.afterValue),
            editorLabel: formatHistorySurname(item.editorLabel),
            hover: { userId: item.targetUserId, day: item.dayYmd },
          }))
        : [],
    [isScheduleHistoryLoaded, scheduleHistoryItems],
  );

  const filteredScheduleHistoryItems = useMemo(() => {
    const query = scheduleHistorySearch.trim().toLowerCase();
    return scheduleHistoryItems.filter((item) => {
      if (scheduleHistoryTargetFilter !== 'all' && item.targetLabel !== scheduleHistoryTargetFilter) return false;
      if (!query) return true;
      return [
        item.projectLabel,
        item.targetLabel,
        formatHistoryGroupsValue(item.beforeGroups, item.beforeValue),
        formatHistoryGroupsValue(item.afterGroups, item.afterValue),
        formatHistoryChange(item.beforeValue, item.afterValue, item.beforeGroups, item.afterGroups),
        item.targetUserLabel,
        item.editorLabel,
        item.dayYmd,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [scheduleHistoryItems, scheduleHistorySearch, scheduleHistoryTargetFilter]);

  const scheduleHistoryPanel = useMemo(
    () =>
      hasScheduleEditPermission
        ? {
            widthClassName: 'w-[min(96vw,1100px)] max-w-[calc(100vw-1rem)]',
            content: (
              <ScheduleHistoryPanel
                embedded
                items={filteredScheduleHistoryItems}
                total={scheduleHistoryTotal}
                loading={scheduleHistoryLoading}
                error={scheduleHistoryError}
                search={scheduleHistorySearch}
                onSearchChange={setScheduleHistorySearch}
                targetFilter={scheduleHistoryTargetFilter}
                onTargetFilterChange={setScheduleHistoryTargetFilter}
                onItemHover={setHistoryHover}
                onRefresh={() => void loadScheduleHistory()}
              />
            ),
          }
        : undefined,
    [
      filteredScheduleHistoryItems,
      hasScheduleEditPermission,
      loadScheduleHistory,
      scheduleHistoryError,
      scheduleHistoryLoading,
      scheduleHistorySearch,
      scheduleHistoryTargetFilter,
      scheduleHistoryTotal,
    ],
  );

  const userLabelById = useMemo(() => {
    const pools: ApiUser[] = [
      ...(data?.users ?? []),
      ...(monthData?.users ?? []),
      ...(yearData?.users ?? []),
    ];
    const map = new Map<string, string>();
    for (const u of pools) {
      map.set(u.id, u.name ?? u.email ?? u.id);
    }
    return map;
  }, [data?.users, monthData?.users, yearData?.users]);

  const currentUsersForOrder = useMemo(() => {
    if (mode === 'week') return data?.users ?? [];
    if (mode === 'month') return monthData?.users ?? [];
    return yearData?.users ?? [];
  }, [data?.users, mode, monthData?.users, yearData?.users]);

  const normalizeCurrentUserOrder = useCallback(
    (order: string[]) => normalizeUserOrder(order, currentUsersForOrder),
    [currentUsersForOrder],
  );

  const moveUserOrder = useCallback(
    (order: string[], userId: string, dir: -1 | 1) => {
      const base = normalizeCurrentUserOrder(order);
      const currentIndex = base.indexOf(userId);
      if (currentIndex < 0) return base;
      const nextIndex = currentIndex + dir;
      if (nextIndex < 0 || nextIndex >= base.length) return base;
      const next = [...base];
      const temp = next[currentIndex];
      next[currentIndex] = next[nextIndex];
      next[nextIndex] = temp;
      return next;
    },
    [normalizeCurrentUserOrder],
  );

  useEffect(() => {
    if (currentUsersForOrder.length === 0) return;
    writeCachedUserCandidates(
      currentUsersForOrder.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        kind: apiKind,
        passwordConfigured: null,
      })),
    );
  }, [apiKind, currentUsersForOrder]);

  useEffect(() => {
    if (!currentUserOrderScope) return;
    if (userOrderLoadedScopeRef.current !== currentUserOrderScope) return;
    const currentOrder = userOrderRef.current;
    const next = normalizeUserOrder(currentOrder, currentUsersForOrder);
    if (arrayEqual(next, currentOrder)) return;
    persistUserOrderChange(next);
  }, [currentUserOrderScope, currentUsersForOrder, persistUserOrderChange]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  useEffect(() => {
    if (mode !== 'week') return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsLoading(true);
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const res = await fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`, {
                signal: controller.signal,
                cache: 'no-store',
              });
              if (!res.ok) {
                if (attempt === 0 && (res.status === 500 || res.status === 503)) {
                  await new Promise((resolve) => window.setTimeout(resolve, 350));
                  continue;
                }
                throw new Error(`Failed to load (${res.status})`);
              }
              const json = (await res.json()) as ApiResponse;
              setData(json);
              return;
            } catch {
              if (controller.signal.aborted) return;
              if (attempt === 0) {
                await new Promise((resolve) => window.setTimeout(resolve, 350));
                continue;
              }
              throw new Error('Failed to load schedule');
            }
          }
        } catch {
          // Keep UI usable even if API is not ready.
          setData(null);
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [kindQuery, mode, weekStart]);

  const viewMonth = useMemo(() => {
    return `${cursorDate.getFullYear()}-${pad2(cursorDate.getMonth() + 1)}`;
  }, [cursorDate]);

  const viewYear = useMemo(() => cursorDate.getFullYear(), [cursorDate]);

  const refreshCurrentView = useCallback(async () => {
    try {
      if (mode === 'week') {
        const res = await fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`, {
          cache: 'no-store',
        });
        if (res.ok) setData((await res.json()) as ApiResponse);
        return;
      }
      if (mode === 'month') {
        const res = await fetch(`/api/schedule/month?month=${encodeURIComponent(viewMonth)}&${kindQuery}`, {
          cache: 'no-store',
        });
        if (res.ok) setMonthData((await res.json()) as MonthApiResponse);
        return;
      }
      if (mode === 'year') {
        const res = await fetch(
          `/api/schedule/year/summary?year=${encodeURIComponent(String(viewYear))}&${kindQuery}`,
          { cache: 'no-store' },
        );
        if (res.ok) setYearData((await res.json()) as YearSummaryApiResponse);
      }
    } catch {
      // ignore
    }
  }, [kindQuery, mode, viewMonth, viewYear, weekStart]);

  const createUser = useCallback(
    async (input: { name: string; email: string }) => {
      const name = input.name.trim();
      const email = input.email.trim();
      if (!name && !email) return { ok: false as const, error: '名前 または メールが必要です' };

      try {
        const r = await fetch('/api/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name || null,
            email: email || null,
            kind: apiKind,
          }),
        });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
          return { ok: false as const, error: msg };
        }

        const user = obj.user && typeof obj.user === 'object' ? (obj.user as Record<string, unknown>) : null;
        const userId = typeof user?.id === 'string' ? user.id : null;
        if (!userId) return { ok: false as const, error: 'Invalid response' };

        persistUserOrderChange((cur) => {
          const base = normalizeCurrentUserOrder(cur);
          const next = base.includes(userId) ? base : [...base, userId];
          return next;
        });

        try {
          window.dispatchEvent(
            new CustomEvent('masterHub:dataChanged', {
              detail: { kind: 'user', action: 'created', targetKind: scheduleKind },
            }),
          );
        } catch {
          // ignore
        }

        await refreshCurrentView();
        return { ok: true as const, userId };
      } catch {
        return { ok: false as const, error: '作成に失敗しました' };
      }
    },
    [apiKind, normalizeCurrentUserOrder, persistUserOrderChange, refreshCurrentView, scheduleKind],
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      const label = userLabelById.get(userId) ?? userId;
      if (!window.confirm(`「${label}」を削除しますか？`)) return;

      try {
        const r = await fetch(`/api/users?id=${encodeURIComponent(userId)}`, {
          method: 'DELETE',
        });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
          showCellActionMsg(`削除に失敗しました: ${msg}`);
          return;
        }

        if (selectedUserId === userId) {
          setSelectedUserId(null);
        }

        persistUserOrderChange((cur) => {
          const next = normalizeCurrentUserOrder(cur).filter((id) => id !== userId);
          return effectiveUserIdRef.current === userId ? cur : next;
        });

        await refreshCurrentView();
        showCellActionMsg('削除しました');
      } catch {
        showCellActionMsg('削除に失敗しました');
      }
    },
    [normalizeCurrentUserOrder, persistUserOrderChange, refreshCurrentView, selectedUserId, showCellActionMsg, userLabelById],
  );

  const refreshSites = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`/api/sites?month=${encodeURIComponent(deprMonth)}&kind=${scheduleKind}`, {
          cache: 'no-store',
        });
        if (!r.ok) {
          if (attempt === 0 && (r.status === 500 || r.status === 503)) {
            await new Promise((resolve) => window.setTimeout(resolve, 350));
            continue;
          }
          return;
        }

        const json = (await r.json()) as {
          ok: true;
          sites: Array<{
            id: string;
            companyName?: string | null;
            name: string;
            scheduleLabelColor?: string | null;
            contactName?: string | null;
            createdAt?: string;
            depreciationThreshold?: number;
            alertsEnabled?: boolean;
            invoiceIssuedThisMonth?: boolean;
            reportIssuedThisMonth?: boolean;
            repeatRule?: unknown;
            pace?: string | null;
            paceExpectedThisMonth?: number;
            paceActualThisMonth?: number;
            paceNotConsumedAlert?: boolean;
            unassignedThisMonth?: boolean;
          }>;
        };
        if (!json?.ok) return;
        const nextDeprMap: Record<string, { count: number; threshold: number; alert: boolean }> = {};
        for (const s of json.sites) {
          const count = typeof s.paceActualThisMonth === 'number' ? s.paceActualThisMonth : 0;
          const threshold = typeof s.depreciationThreshold === 'number' ? s.depreciationThreshold : 10;
          const alertsEnabled = s.alertsEnabled ?? true;
          nextDeprMap[s.id] = { count, threshold, alert: alertsEnabled ? count >= threshold : false };
        }
        setSiteDeprMap(nextDeprMap);
        setSites(json.sites.map((s) => {
          const label = s.companyName ? `${s.companyName} / ${s.name}` : s.name;
          return {
            id: s.id,
            label,
            name: s.name,
            companyName: s.companyName ?? null,
            scheduleLabelColor: isLabelColor(s.scheduleLabelColor) ? s.scheduleLabelColor : 'default',
            badgeMonthVisible:
              !hasConfiguredPace(s.repeatRule, s.pace) || (typeof s.paceExpectedThisMonth === 'number' && s.paceExpectedThisMonth > 0),
            invoiceIssuedThisMonth: s.invoiceIssuedThisMonth,
            reportIssuedThisMonth: s.reportIssuedThisMonth,
            paceNotConsumedAlert: s.paceNotConsumedAlert,
            unassignedThisMonth: s.unassignedThisMonth,
            pace: s.pace,
            repeatRule: s.repeatRule,
            contactName: typeof s.contactName === 'string' ? s.contactName : null,
            createdAt: typeof s.createdAt === 'string' ? s.createdAt : null,
          };
        }));
        return;
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          continue;
        }
        return;
      }
    }
  }, [deprMonth, scheduleKind]);

  useEffect(() => {
    void refreshSites();
  }, [refreshSites]);

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const e = ev as CustomEvent<
        | { kind: 'user' | 'site'; action: 'created'; targetKind: 'normal' | 'daily' }
        | undefined
      >;
      const d = e.detail;
      if (!d || d.action !== 'created') return;
      if (d.targetKind !== scheduleKind) return;

      if (d.kind === 'user') {
        void refreshCurrentView();
        return;
      }
      if (d.kind === 'site') {
        void refreshSites();
        return;
      }
    };

    window.addEventListener('masterHub:dataChanged', onChanged as EventListener);
    return () => window.removeEventListener('masterHub:dataChanged', onChanged as EventListener);
  }, [refreshCurrentView, refreshSites, scheduleKind]);

  const pushHistory = (entry: CellHistoryEntry) => {
    setUndoStack((cur) => {
      const last = cur[cur.length - 1];
      if (
        last &&
        last.kind === 'cell' &&
        last.userId === entry.userId &&
        last.day === entry.day &&
        last.editorLabel === entry.editorLabel &&
        entry.at - last.at <= HISTORY_GROUP_MS &&
        apiCellsEqual(last.after, entry.before)
      ) {
        const merged: CellHistoryEntry = {
          ...last,
          after: entry.after,
          at: entry.at,
        };
        const next = [...cur.slice(0, -1), merged];
        const limit = 50;
        return next.length > limit ? next.slice(next.length - limit) : next;
      }

      const next = [...cur, entry];
      const limit = 50;
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
    setRedoStack([]);
  };

  const restoreCell = useCallback(async (entry: CellHistoryEntry, target: 'before' | 'after') => {
    setIsUndoRedoBusy(true);
    try {
      const targetCell = cloneApiCell(target === 'before' ? entry.before : entry.after);
      const rollbackCellFromHistory = cloneApiCell(target === 'before' ? entry.after : entry.before);
      const visibleCell =
        mode === 'week'
          ? data?.grid[entry.userId]?.[entry.day]
          : mode === 'month'
            ? monthData?.grid[entry.userId]?.[entry.day]
            : null;
      const rollbackCell = cloneApiCell(visibleCell ?? rollbackCellFromHistory);

      updateVisibleCell({ userId: entry.userId, day: entry.day, cell: targetCell });

      const r = await fetch('/api/schedule/cell/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: entry.userId,
          day: entry.day,
          kind: apiKind,
          slot1: targetCell.slot1,
          slot2: targetCell.slot2,
          slot1Color: targetCell.color1,
          slot2Color: targetCell.color2,
          groups: apiCellToGroups(targetCell),
        }),
      });
      const json = (await r.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error?: string }
        | null;
      if (!r.ok || !json || !('ok' in json) || json.ok !== true) {
        updateVisibleCell({ userId: entry.userId, day: entry.day, cell: rollbackCell });
        const msg = json && 'ok' in json && json.ok === false ? json.error : undefined;
        showCellActionMsg(msg ? `Undo/Redoに失敗: ${msg}` : `Undo/Redoに失敗（HTTP ${r.status}）`);
        return false;
      }
      void refreshCurrentView();
      return true;
    } catch {
      updateVisibleCell({
        userId: entry.userId,
        day: entry.day,
        cell: cloneApiCell(target === 'before' ? entry.after : entry.before),
      });
      showCellActionMsg('Undo/Redoの通信に失敗しました');
      return false;
    } finally {
      setIsUndoRedoBusy(false);
    }
  }, [apiKind, data?.grid, mode, monthData?.grid, refreshCurrentView, showCellActionMsg, updateVisibleCell]);

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    const ok = await restoreCell(last, 'before');
    if (!ok) return;
    setUndoStack((cur) => cur.slice(0, -1));
    setRedoStack((cur) => [...cur, last]);
    showCellActionMsg('取り消しました');
  }, [restoreCell, showCellActionMsg, undoStack]);

  const redo = useCallback(async () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    const ok = await restoreCell(last, 'after');
    if (!ok) return;
    setRedoStack((cur) => cur.slice(0, -1));
    setUndoStack((cur) => [...cur, last]);
    showCellActionMsg('やり直しました');
  }, [redoStack, restoreCell, showCellActionMsg]);

  const searchSites = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSiteSuggestions([]);
      return;
    }
    setSuggestionLoading(true);
    try {
      const r = await fetch(`/api/sites?search=${encodeURIComponent(query)}`);
      const json = (await r.json().catch(() => null)) as unknown;
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        setSiteSuggestions([]);
        return;
      }
      const raw = Array.isArray(obj.sites) ? obj.sites : [];
      const parsed = raw
        .map((x) => {
          const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
          const id = typeof o?.id === 'string' ? o.id : null;
          const name = typeof o?.name === 'string' ? o.name : null;
            const companyName = typeof o?.companyName === 'string' ? o.companyName : null;
          if (!id || !name) return null;
          return {
            id,
              label: companyName ? `${companyName} / ${name}` : name,
              name,
              companyName,
            scheduleLabelColor: isLabelColor(o?.scheduleLabelColor) ? o.scheduleLabelColor : 'default',
          } as SiteItem;
        })
        .filter((x): x is SiteItem => !!x);
      setSiteSuggestions(parsed.slice(0, 10));
    } catch {
      setSiteSuggestions([]);
    } finally {
      setSuggestionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!editingCell || editingCell.source === 'button') {
      setSiteSuggestions([]);
      setSuggestionLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchSites(editingInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [editingCell, editingInput, searchSites]);

  useEffect(() => {
    if (!editingCell) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // インライン編集UI内の操作は閉じない
      if (target.closest('[data-inline-editor]') || target.closest('[data-suggestion-list]')) return;
      setEditingCell(null);
      setEditingInput('');
      setSiteSuggestions([]);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingCell]);

  useEffect(() => {
    if (mode !== 'month') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/month?month=${encodeURIComponent(viewMonth)}&${kindQuery}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as MonthApiResponse;
      })
      .then((json) => setMonthData(json))
      .catch(() => {
        setMonthData(null);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [kindQuery, mode, viewMonth]);

  useEffect(() => {
    if (mode !== 'year') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/year/summary?year=${encodeURIComponent(String(viewYear))}&${kindQuery}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as YearSummaryApiResponse;
      })
      .then((json) => setYearData(json))
      .catch(() => {
        setYearData(null);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [kindQuery, mode, viewYear]);

  useEffect(() => {
    if (!siteDetailOpen) return;
    if (!selectedSite?.id) {
      setDeprState({ status: 'error', message: '現場IDがありません（台帳から選択してください）' });
      return;
    }

    const controller = new AbortController();
    setDeprSaveMsg(null);
    setDeprState({ status: 'loading' });
    fetch(
      `/api/sites/depreciation-count?siteId=${encodeURIComponent(selectedSite.id)}&month=${encodeURIComponent(deprMonth)}&${kindQuery}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as
          | { ok: true; count: number; threshold: number; alert: boolean }
          | { ok: false; error?: string }
          | null;
        if (!r.ok || !json || !json.ok) {
          throw new Error((json && !json.ok ? json.error : undefined) || `HTTP ${r.status}`);
        }
        setDeprState({ status: 'ok', count: json.count, threshold: json.threshold, alert: json.alert });
        setDeprThresholdInput(String(json.threshold));
      })
      .catch((e) => {
        setDeprState({ status: 'error', message: e instanceof Error ? e.message : '読み込みに失敗しました' });
      });

    return () => controller.abort();
  }, [deprMonth, kindQuery, selectedSite?.id, siteDetailOpen]);

  useEffect(() => {
    const controller = new AbortController();

    const loadScheduleSites = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(`/api/schedule/sites?${kindQuery}`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (!r.ok) {
            if (attempt === 0 && (r.status === 500 || r.status === 503)) {
              await new Promise((resolve) => window.setTimeout(resolve, 350));
              continue;
            }
            return;
          }

          const json = (await r.json()) as {
            ok: true;
            names: string[];
            sites?: Array<{ id: string; label: string }>;
          };
          if (!json?.ok) return;
          const fromLedger = (json.sites ?? []).map((s) => ({ id: s.id, label: s.label }));
          if (fromLedger.length > 0) {
            setSites((cur) => mergeSiteItems(cur, fromLedger));
          } else {
            setSites((cur) => mergeSiteItems(cur, (json.names ?? []).map((label) => ({ id: null, label }))));
          }
          return;
        } catch {
          if (controller.signal.aborted) return;
          if (attempt === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 350));
            continue;
          }
          return;
        }
      }
    };

    const win = window as Window & typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let timer: number | null = null;
    let idleHandle: number | null = null;

    if (typeof win.requestIdleCallback === 'function') {
      idleHandle = win.requestIdleCallback(() => {
        void loadScheduleSites();
      }, { timeout: 1500 });
    } else {
      timer = window.setTimeout(() => {
        void loadScheduleSites();
      }, 1000);
    }

    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      if (idleHandle !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleHandle);
      }
    };
  }, [kindQuery]);

  useEffect(() => {
    if (!selectedSite?.id) {
      setSelectedSiteCreatedAt(null);
      setContactNameInput('');
      return;
    }
    setSelectedSiteCreatedAt(selectedSite.createdAt ? String(selectedSite.createdAt) : null);
    setContactNameInput(typeof selectedSite.contactName === 'string' ? selectedSite.contactName : '');
    setRepeatRule(buildRepeatRuleWithPace(selectedSite.repeatRule ?? null, typeof selectedSite.pace === 'string' ? selectedSite.pace : null));
  }, [selectedSite]);

  const autoFillPreview = useMemo(() => {
    if (!selectedSite?.id) {
      return { status: 'no-site' as const, targets: [] as string[] };
    }
    return buildAutoFillTargets({
      rule: repeatRule,
      month: autoFillMonth,
      anchorDate: selectedSiteCreatedAt,
    });
  }, [autoFillMonth, repeatRule, selectedSite?.id, selectedSiteCreatedAt]);

  const autoFillUserIdByContact = useMemo(() => {
    const contact = contactNameInput.trim();
    if (!contact) return null;

    const users = data?.users ?? monthData?.users ?? yearData?.users ?? [];
    if (users.length === 0) return null;

    const hitByName = users.find((u) => (u.name ?? '').trim() === contact);
    if (hitByName) return hitByName.id;

    const lower = contact.toLowerCase();
    const hitByEmail = users.find((u) => (u.email ?? '').trim().toLowerCase() === lower);
    return hitByEmail?.id ?? null;
  }, [contactNameInput, data?.users, monthData?.users, yearData?.users]);

  const effectiveAutoFillUserId = selectedUserId ?? autoFillUserIdByContact;

  const dayLabels = useMemo(() => {
    return days.map((d, i) => ({
      key: toYmd(d),
      dow: DOW[i],
      dayNum: d.getDate(),
      isSat: i === 5,
      isSun: i === 6,
    }));
  }, [days]);

  const monthDayLabels = useMemo(() => {
    if (!monthData?.ok) return [] as Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
    return monthData.days.map((ymd) => {
      const d = new Date(`${ymd}T00:00:00`);
      const dow0Sun = d.getDay();
      const dowMon0 = dow0Sun === 0 ? 6 : dow0Sun - 1;
      return {
        key: ymd,
        dow: DOW[dowMon0],
        dayNum: d.getDate(),
        isSat: dow0Sun === 6,
        isSun: dow0Sun === 0,
      };
    });
  }, [monthData]);

  const weekVisiblePaceTargets = useMemo(() => {
    if (!selectedSite?.id || !effectiveAutoFillUserId) return new Set<string>();
    const result = buildAutoFillTargets({
      rule: repeatRule,
      days: dayLabels.map((day) => day.key),
      anchorDate: selectedSiteCreatedAt,
    });
    return new Set(result.status === 'ok' ? result.targets : []);
  }, [dayLabels, effectiveAutoFillUserId, repeatRule, selectedSite?.id, selectedSiteCreatedAt]);

  const monthVisiblePaceTargets = useMemo(() => {
    if (!selectedSite?.id || !effectiveAutoFillUserId) return new Set<string>();
    const result = buildAutoFillTargets({
      rule: repeatRule,
      days: monthDayLabels.map((day) => day.key),
      anchorDate: selectedSiteCreatedAt,
    });
    return new Set(result.status === 'ok' ? result.targets : []);
  }, [effectiveAutoFillUserId, monthDayLabels, repeatRule, selectedSite?.id, selectedSiteCreatedAt]);

  const monthWeekTabs = useMemo(() => {
    // Always show 5 weeks centered on the current week
    const centerWeek = startOfWeekMonday(new Date(cursorDate));
    const tabs: Date[] = [];
    
    // Add 2 weeks before the center week
    for (let i = -2; i <= 2; i++) {
      const d = new Date(centerWeek);
      d.setDate(d.getDate() + i * 7);
      tabs.push(new Date(d));
    }
    
    return {
      monthKey: `${cursorDate.getFullYear()}-${pad2(cursorDate.getMonth() + 1)}`,
      tabs,
    };
  }, [cursorDate]);

  const setWeekStartByDate = (d: Date) => {
    setCursorDate(new Date(d));
  };

  const goPrevMonth = () => {
    const ws = startOfWeekMonday(cursorDate);
    setCursorDate(new Date(ws.getFullYear(), ws.getMonth() - 1, 15));
  };
  const goNextMonth = () => {
    const ws = startOfWeekMonday(cursorDate);
    setCursorDate(new Date(ws.getFullYear(), ws.getMonth() + 1, 15));
  };

  const goPrevYear = () => {
    setCursorDate(new Date(cursorDate.getFullYear() - 1, 0, 1));
  };
  const goNextYear = () => {
    setCursorDate(new Date(cursorDate.getFullYear() + 1, 0, 1));
  };

  const openMonthFromYear = (month: string, userId: string) => {
    setSelectedUserId(userId);
    setMode('month');
    setCursorDate(new Date(`${month}-01T00:00:00`));
  };

  const modeTabs = (
    <div
      id="mode-tabs"
      ref={modeTabsRef}
      className="sticky top-[var(--app-header-h)] z-40 scroll-mt-20 rounded-lg border border-zinc-200 bg-white px-2 py-2 sm:rounded-xl sm:px-3 dark:border-zinc-800 dark:bg-black"
    >
      <div className="flex flex-col gap-1.5 sm:gap-3">
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 lg:gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {[
              { key: 'week', label: '週予定' },
              { key: 'month', label: '月予定' },
              { key: 'year', label: '年予定' },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setMode(tab.key as ViewMode)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  mode === tab.key
                    ? 'border-blue-500 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-800'
                    : 'border-zinc-200 bg-white/60 text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200 dark:hover:bg-black'
                }`}
              >
                {tab.label}
              </button>
            ))}

            {isElectronShell ? (
              <div className="ml-0 flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs sm:ml-2">
                <span className="text-zinc-500 dark:text-zinc-400">従業員:</span>
                {selectedUserId ? (
                  <span
                    className="min-w-0 flex-1 truncate rounded-full border border-zinc-200 bg-white/60 px-2 py-1 text-zinc-700 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200"
                    title={selectedUserLabel ?? selectedUserId}
                    data-testid="selected-user-chip"
                  >
                    {selectedUserLabel ?? selectedUserId}
                  </span>
                ) : (
                  <span className="rounded-full border border-zinc-200 bg-white/60 px-2 py-1 text-zinc-400 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-500">
                    （なし）
                  </span>
                )}

                {hasScheduleEditPermission ? (
                  <button
                    type="button"
                    onClick={() => setReorderMode((v) => !v)}
                    disabled={!editActive}
                    className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    aria-pressed={reorderMode}
                  >
                    {reorderMode ? '並べ替え: ON' : '並べ替え'}
                  </button>
                ) : null}

                {selectedUserId ? (
                  <button
                    type="button"
                    onClick={() => setSelectedUserId(null)}
                    className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    aria-label="選択解除"
                    data-testid="clear-selected-user"
                  >
                    解除
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end sm:gap-2">
            {mode === 'month' ? (
              <div className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300" data-testid="modebar-month">
                {viewMonth}
              </div>
            ) : mode === 'year' ? (
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={goPrevYear}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="前の年"
                >
                  ←
                </button>
                <div
                  className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300"
                  data-testid="modebar-year"
                >
                  {viewYear}年
                </div>
                <button
                  type="button"
                  onClick={goNextYear}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="次の年"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStartByDate(new Date())}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  今年
                </button>
              </div>
            ) : mode === 'week' ? (
              <div className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300" data-testid="modebar-week">
                {toYmd(weekStart)}〜{toYmd(addDays(weekStart, 6))}
              </div>
            ) : null}

            {isElectronShell && mode !== 'year' ? cellActionButtons : null}

            {isLoading ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
            ) : null}
          </div>
        </div>

        {cellActionMsg ? (
          <div
            className="max-w-full truncate text-xs text-zinc-500 dark:text-zinc-400 sm:max-w-[60vw]"
            role="status"
            aria-live="polite"
            data-testid="cell-action-msg"
            title={cellActionMsg}
          >
            {cellActionMsg}
          </div>
        ) : null}
      </div>
    </div>
  );

  useEffect(() => {
    const el = modeTabsRef.current;
    if (!el) return;
    const apply = () => {
      const h = Math.max(0, Math.round(el.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--mode-tabs-h', `${h || 0}px`);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [mode]);

  useEffect(() => {
    if (!editActive && reorderMode) setReorderMode(false);
  }, [editActive, reorderMode]);

  useEffect(() => {
    if (!hasScheduleEditPermission) {
      if (isColorEditMode) {
        setColorEditMode(false);
      }
      if (cellClickAction === 'recolor') {
        setCellClickAction(lastNonColorCellActionRef.current);
      }
      setEditActive(false);
      setReorderMode(false);
      setShowEditPassword(false);
    }
  }, [cellClickAction, hasScheduleEditPermission, isColorEditMode, setColorEditMode]);

  const beginEdit = useCallback(() => {
    setEditPasswordMsg(null);
    if (!hasScheduleEditPermission) {
      showCellActionMsg('編集権限がありません');
      return;
    }
    if (editEnabled) {
      setEditActive(true);
      return;
    }
    setShowEditPassword(true);
  }, [editEnabled, hasScheduleEditPermission, showCellActionMsg]);

  const submitEditPassword = useCallback(async () => {
    setEditPasswordMsg(null);
    try {
      const r = await fetch('/api/auth/edit-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: editPassword }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || o?.ok !== true) {
        const msg = typeof o?.error === 'string' ? (o.error as string) : `HTTP ${r.status}`;
        setEditPasswordMsg(msg);
        return;
      }
      setEditEnabled(true);
      setShowEditPassword(false);
      setEditPassword('');
      setEditActive(true);
    } catch {
      setEditPasswordMsg('通信に失敗しました');
    }
  }, [editPassword]);

  useEffect(() => {
    setAddAction({
      onClick: beginEdit,
      disabled: editActive || !hasScheduleEditPermission,
      title: !hasScheduleEditPermission
        ? '編集権限がありません'
        : editEnabled
          ? '編集を開始'
          : editConfigured
            ? '編集（パスワード）'
            : '編集',
    });

    setSaveAction(
      editActive
        ? {
            onClick: async () => {
              await flushUserOrderSave();
              if (cellClickAction === 'recolor') {
                setCellClickAction(lastNonColorCellActionRef.current);
              }
              setColorEditMode(false);
              setEditActive(false);
            },
            disabled: false,
            title: '編集を終了',
          }
        : undefined,
    );

    setHistoryMenu(
      hasScheduleEditPermission
        ? {
            items: historyPreviewItems,
            loading: scheduleHistoryLoading,
            loaded: isScheduleHistoryLoaded,
            emptyLabel: scheduleHistoryError ?? '編集履歴はありません。',
            onHover: (hover) => setHistoryHover(hover),
          }
        : undoStack.length > 0
          ? {
              items: [...undoStack]
                .slice(-40)
                .reverse()
                .map((h) => ({
                  key: `${h.at}:${h.userId}:${h.day}`,
                  at: h.at,
                  targetLabel: `${formatHistoryMonthDay(h.day)} ${formatHistorySurname(userLabelById.get(h.userId) ?? h.userId)}`,
                  beforeLabel: formatCellSlotsValue(h.before),
                  afterLabel: formatCellSlotsValue(h.after),
                  editorLabel: formatHistorySurname(h.editorLabel),
                  hover: { userId: h.userId, day: h.day },
                })),
              loaded: true,
              emptyLabel: '編集履歴はありません。',
              onHover: (hover) => setHistoryHover(hover),
            }
          : undefined,
    );

    return () => {
      setAddAction(undefined);
      setSaveAction(undefined);
      setHistoryMenu(undefined);
    };
  }, [
    beginEdit,
    cellClickAction,
    editActive,
    editConfigured,
    editEnabled,
    flushUserOrderSave,
      hasScheduleEditPermission,
      historyPreviewItems,
      isScheduleHistoryLoaded,
      scheduleHistoryError,
      scheduleHistoryLoading,
    setAddAction,
    setHistoryMenu,
    setColorEditMode,
    setSaveAction,
    undoStack,
    userLabelById,
  ]);

  useEffect(() => {
    setHistoryAction(
      hasScheduleEditPermission
        ? {
            onClick: () => {
              void loadScheduleHistory();
            },
            disabled: false,
            title: '編集履歴一覧',
          }
        : undefined,
    );

    return () => {
      setHistoryAction(undefined);
    };
  }, [hasScheduleEditPermission, loadScheduleHistory, setHistoryAction]);

  useEffect(() => {
    setHistoryPanel(scheduleHistoryPanel);

    return () => {
      setHistoryPanel(undefined);
    };
  }, [scheduleHistoryPanel, setHistoryPanel]);

  useEffect(() => {
    const canUndo = undoStack.length > 0 && !isUndoRedoBusy;
    const canRedo = redoStack.length > 0 && !isUndoRedoBusy;

    setUndoAction(
      canUndo
        ? {
            onClick: undo,
            disabled: !canUndo,
            title: '入力を取り消し',
          }
        : undefined,
    );
    setRedoAction(
      canRedo
        ? {
            onClick: redo,
            disabled: !canRedo,
            title: '入力をやり直し',
          }
        : undefined,
    );

    return () => {
      setUndoAction(undefined);
      setRedoAction(undefined);
    };
  }, [isUndoRedoBusy, redo, redoStack.length, setRedoAction, setUndoAction, undo, undoStack.length]);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50" style={{ overflowX: 'clip' }}>
      <div className="w-full min-w-0 px-2 py-3 sm:px-3 sm:py-4 lg:px-6">
        {isOffline ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
            オフラインのため、表示が古い可能性があります。
          </div>
        ) : null}

        {showEditPassword ? (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
            <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">編集パスワード</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">この端末で編集を有効にします。</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                className="w-64 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                placeholder="パスワード"
              />
              <button
                type="button"
                onClick={() => void submitEditPassword()}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => setShowEditPassword(false)}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                キャンセル
              </button>
            </div>
            {editPasswordMsg ? (
              <div className="mt-2 text-xs text-red-700 dark:text-red-300">{editPasswordMsg}</div>
            ) : null}
          </div>
        ) : null}
        {/* Main content */}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[360px_1fr]">
          {mode === 'week' ? (
            <>
              <div className="hidden lg:block rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black lg:sticky lg:top-[calc(var(--app-header-h)+var(--mode-tabs-h,0px))] lg:max-h-[calc(100vh-var(--app-header-h)-var(--mode-tabs-h,0px))] lg:self-start lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
                <div onWheel={onSiteBannerWheel}>
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    現場を選択 → 週表のセルをクリックで入力
                  </div>
                  <div className="mt-3 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">現場（既存/新規）</div>
                    <div className="mt-1 flex gap-2">
                      <input
                        ref={siteQuickInputRef}
                        value={siteQuickInput}
                        onInput={handleSiteQuickInput}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          void pickSiteFromInput();
                        }}
                        placeholder="例: ○○現場  または  会社 / ○○現場"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <button
                        type="button"
                        onClick={() => void pickSiteFromInput()}
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        選択
                      </button>
                    </div>
                    {siteQuickMsg ? (
                      <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">{siteQuickMsg}</div>
                    ) : null}
                  </div>
                </div>

                <div
                  ref={sitePaneScrollRef}
                  className="mt-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overscroll-contain"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400">バッジ月（償却）</div>
                    <input
                      type="month"
                      value={deprMonth}
                      onChange={(e) => setDeprMonthForCurrentKind(e.target.value)}
                      className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">検索</div>
                    <input
                      value={siteQuery}
                      onInput={handleSiteQueryInput}
                      placeholder="現場名で絞り込み"
                      className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div
                    className="mt-2 min-h-48 max-h-96 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-black lg:min-h-0 lg:flex-1 lg:max-h-none"
                  >
                    {sites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        まだ候補がありません（過去データから自動で出ます）。
                      </div>
                    ) : visibleSites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません。</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleSites.map((s) => {
                          const active = selectedSite?.label === s.label;
                          const badge = s.id ? siteDeprMap[s.id] : undefined;
                          const searchHighlighted = hasSiteQuery;
                          const siteColor = resolveSiteLabelColor(s, 'default');
                          return (
                            <button
                              key={s.id ?? s.label}
                              type="button"
                              data-site-id={s.id ?? undefined}
                              draggable={editActive}
                              onDragStart={(e) => {
                                if (!editActive) return;
                                setDraggedSite(s);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onDragEnd={() => setDraggedSite(null)}
                              onClick={() => {
                                if (active && s.id) {
                                  const sp = new URLSearchParams({ kind: scheduleKind });
                                  if (selectedUserId) sp.set('userId', selectedUserId);
                                  router.push(`/site-ledger/${encodeURIComponent(s.id)}?${sp.toString()}`);
                                  return;
                                }
                                setSelectedSite(s);
                              }}
                              className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                                searchHighlighted
                                  ? siteSearchHighlightClass(siteColor)
                                  : active
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              } ${active ? 'font-medium outline outline-1 outline-zinc-300 dark:outline-zinc-600' : ''} ${editActive ? 'cursor-move' : ''}`}
                              style={searchHighlighted ? siteSearchHighlightStyle(siteColor) : undefined}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex flex-1 items-center gap-1">
                                  <span className="truncate">
                                    {s.label.includes(' / ') ? s.label.split(' / ').slice(1).join(' / ') : s.label}
                                  </span>
                                  {s.label.includes('!') ? (
                                    <span className="ml-2 text-red-600 dark:text-red-400">!</span>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {s.invoiceIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500 dark:bg-green-600"
                                      title="請求未発行"
                                    />
                                  ) : null}
                                  {s.reportIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-400 dark:bg-orange-500"
                                      title="報告未発行"
                                    />
                                  ) : null}
                                  {s.unassignedThisMonth ? (
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 dark:bg-red-600"
                                      title="未配置"
                                    />
                                  ) : null}
                                  {badge ? (
                                    <span
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!s.id) return;
                                        setSelectedSite(s);
                                        setSiteDetailOpen(true);
                                      }}
                                      className={depreciationBadgeClass(badge.alert)}
                                      title={`今月(${deprMonth}): ${badge.count}件 / 月回数 ${badge.threshold}`}
                                    >
                                      {badge.count}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  </div>

                  {selectedSite?.id ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#punch`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        打刻
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#photos`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        写真
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    選択中の現場をもう一度クリックで詳細へ
                  </div>

                {!hasScheduleEditPermission ? (
                  <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                    現場追加、ペース設定、自動入力は編集権限保持者のみ利用できます。
                  </div>
                ) : null}

                <fieldset disabled={!hasScheduleEditPermission} className={!hasScheduleEditPermission ? 'opacity-60' : ''}>
                <div
                  id="site-ledger"
                  className="mt-3 scroll-mt-20 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                >
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場台帳（追加）</div>
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    新しい現場名を追加できます（devではトークン無しでもOK）。
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newSiteName}
                      onChange={(e) => setNewSiteName(e.target.value)}
                      placeholder="現場名"
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                    <button
                      type="button"
                      disabled={!newSiteName.trim()}
                      onClick={async () => {
                        const name = newSiteName.trim();
                        if (!name) return;
                        setSiteCreateMsg(null);
                        try {
                          const r = await fetch('/api/sites', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ name, kind: apiKind }),
                          });
                          const json = (await r.json().catch(() => null)) as
                            | { ok: true; site: { id: string } }
                            | { ok: false; error?: string }
                            | null;
                          if (!r.ok || !json?.ok) {
                            const msg = json && !json.ok ? json.error : undefined;
                            setSiteCreateMsg(msg || `HTTP ${r.status}`);
                            return;
                          }
                          const created: SiteItem = {
                            id: json.site.id,
                            label: name,
                            name,
                            companyName: null,
                            scheduleLabelColor: 'default',
                          };
                          setSites((cur) => [created, ...cur]);
                          setSelectedSite(created);
                          setNewSiteName('');
                          setSiteCreateMsg('追加しました');
                        } catch {
                          setSiteCreateMsg('作成に失敗しました');
                        }
                      }}
                      className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      追加
                    </button>
                  </div>
                  {siteCreateMsg ? (
                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{siteCreateMsg}</div>
                  ) : null}
                </div>

                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  入力対象の従業員:{' '}
                  {selectedUserId ? selectedUserLabel ?? selectedUserId : '（週表の従業員名をクリックして選択）'}
                </div>

                <div id="management" className="mt-4 scroll-mt-20 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    ペース
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    選択した現場のペース条件（ツリー）を設定します。
                  </div>

                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">
                        月スパン（1〜12ヶ月）
                      </div>
                      <select
                        value={repeatRule.intervalMonths}
                        onChange={(e) =>
                          setRepeatRule((r) => ({
                            ...r,
                            intervalMonths: Number(e.target.value) || 1,
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                        disabled={!selectedSite?.id}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}ヶ月
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">曜日</div>
                      <div className="mt-2 grid grid-cols-7 gap-1">
                        {DOW.map((label, idx) => {
                          const v = idx + 1;
                          const checked = repeatRule.weekdays.includes(v);
                          return (
                            <button
                              key={label}
                              type="button"
                              disabled={!selectedSite?.id}
                              onClick={() =>
                                setRepeatRule((r) => ({
                                  ...r,
                                  weekdays: checked
                                    ? r.weekdays.filter((x) => x !== v)
                                    : [...r.weekdays, v].sort((a, b) => a - b),
                                }))
                              }
                              className={`rounded-md border px-1 py-2 text-xs ${
                                checked
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">日付</div>
                      <div className="mt-2 grid grid-cols-7 gap-1">
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => {
                          const checked = repeatRule.monthDays.includes(n);
                          return (
                            <button
                              key={n}
                              type="button"
                              disabled={!selectedSite?.id}
                              onClick={() =>
                                setRepeatRule((r) => ({
                                  ...r,
                                  monthDays: checked
                                    ? r.monthDays.filter((x) => x !== n)
                                    : [...r.monthDays, n].sort((a, b) => a - b),
                                }))
                              }
                              className={`rounded-md border px-1 py-2 text-[11px] tabular-nums ${
                                checked
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              }`}
                            >
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!selectedSite?.id || isSavingRule}
                      onClick={async () => {
                        if (!selectedSite?.id) return;
                        setIsSavingRule(true);
                        try {
                          await fetch('/api/sites/repeat-rule', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ siteId: selectedSite.id, repeatRule }),
                          });
                        } finally {
                          setIsSavingRule(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                        {isSavingRule ? '保存中…' : 'ペースを保存'}
                    </button>

                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">自動入力の対象月</div>
                      <input
                        type="month"
                        value={autoFillMonth}
                        onChange={(e) => setAutoFillMonth(e.target.value)}
                        className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                    </div>

                    <div className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                      {autoFillPreview.status === 'no-site' ? (
                        <span>プレビュー: 現場を選択してください</span>
                      ) : autoFillPreview.status === 'invalid-month' ? (
                        <span>プレビュー: 対象月が不正です</span>
                      ) : autoFillPreview.status === 'interval-mismatch' ? (
                        <span>プレビュー: ペース対象外の月です</span>
                      ) : autoFillPreview.status === 'no-repeat' ? (
                        <span>プレビュー: ペース条件が未設定です</span>
                      ) : (
                        <span>
                          プレビュー: {autoFillPreview.targets.length}日（
                          {autoFillPreview.targets
                            .slice(0, 14)
                            .map((ymd) => {
                              const day = Number(ymd.slice(-2));
                              const wd = weekdayMon1Sun7FromYmd(ymd);
                              return `${day}(${DOW[wd - 1]})`;
                            })
                            .join('、')}
                          {autoFillPreview.targets.length > 14 ? '…' : ''}）
                        </span>
                      )}
                    </div>

                    {autoFillPreview.status === 'ok' && autoFillPreview.targets.length > 0 ? (
                      <div className="max-h-40 overflow-y-auto rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                        {autoFillPreview.targets.map((ymd) => {
                          const day = Number(ymd.slice(-2));
                          const wd = weekdayMon1Sun7FromYmd(ymd);
                          return (
                            <div key={ymd} className="tabular-nums">
                              {ymd}（{day}日/{DOW[wd - 1]}）
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      disabled={!selectedSite?.id || !effectiveAutoFillUserId || isAutoFilling}
                      onClick={async () => {
                        if (!selectedSite?.id || !effectiveAutoFillUserId) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        try {
                          const r = await fetch('/api/schedule/auto-fill', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              userId: effectiveAutoFillUserId,
                              siteId: selectedSite.id,
                              month: autoFillMonth,
                              kind: apiKind,
                            }),
                          });

                          const json = (await r.json().catch(() => null)) as
                            | { ok: true; created: number; skipped: number; reason?: string }
                            | { ok: false; error?: string }
                            | null;

                          if (json && json.ok) {
                            setAutoFillResult(json);
                          } else {
                            setAutoFillResult({
                              ok: false,
                              error: json?.error || (!r.ok ? `HTTP ${r.status}` : 'Unknown error'),
                            });
                          }

                          void refreshCurrentView();
                        } finally {
                          setIsAutoFilling(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      {isAutoFilling ? '自動入力中…' : '自動入力'}
                    </button>

                    <button
                      type="button"
                      disabled={!selectedSite?.id || !effectiveAutoFillUserId || isAutoFilling}
                      onClick={async () => {
                        if (!selectedSite?.id || !effectiveAutoFillUserId) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        try {
                          const weekDays = Array.from({ length: 7 }, (_, i) => toYmd(addDays(weekStart, i)));
                          const r = await fetch('/api/schedule/auto-fill', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              userId: effectiveAutoFillUserId,
                              siteId: selectedSite.id,
                              month: autoFillMonth,
                              days: weekDays,
                              kind: apiKind,
                            }),
                          });

                          const json = (await r.json().catch(() => null)) as
                            | { ok: true; created: number; skipped: number; reason?: string }
                            | { ok: false; error?: string }
                            | null;

                          if (json && json.ok) {
                            setAutoFillResult(json);
                          } else {
                            setAutoFillResult({
                              ok: false,
                              error: json?.error || (!r.ok ? `HTTP ${r.status}` : 'Unknown error'),
                            });
                          }

                          void refreshCurrentView();
                        } finally {
                          setIsAutoFilling(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      {isAutoFilling ? '自動入力中…' : '自動入力（今週）'}
                    </button>

                    <button
                      type="button"
                      disabled={!selectedSite?.id || isAutoFilling || (data?.users?.length ?? 0) === 0}
                      onClick={async () => {
                        if (!selectedSite?.id) return;
                        const users = data?.users ?? [];
                        if (users.length === 0) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        let createdSum = 0;
                        let skippedSum = 0;
                        let errorCount = 0;
                        try {
                          for (const u of users) {
                            const r = await fetch('/api/schedule/auto-fill', {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                userId: u.id,
                                siteId: selectedSite.id,
                                month: autoFillMonth,
                                kind: apiKind,
                              }),
                            });
                            const json = (await r.json().catch(() => null)) as
                              | { ok: true; created: number; skipped: number }
                              | { ok: false; error?: string }
                              | null;

                            if (r.ok && json && json.ok) {
                              createdSum += json.created;
                              skippedSum += json.skipped;
                            } else {
                              errorCount += 1;
                            }
                          }

                          setAutoFillResult({
                            ok: true,
                            created: createdSum,
                            skipped: skippedSum,
                            reason: errorCount > 0 ? `一部失敗: ${errorCount}人` : undefined,
                          });

                          void refreshCurrentView();
                        } finally {
                          setIsAutoFilling(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      {isAutoFilling ? '自動入力中…' : '自動入力（全員）'}
                    </button>

                    {autoFillResult ? (
                      <div
                        className={`rounded-md border px-2 py-2 text-xs ${
                          autoFillResult.ok
                            ? 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300'
                            : 'border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-black dark:text-red-300'
                        }`}
                      >
                        {autoFillResult.ok ? (
                          <span>
                            結果: created={autoFillResult.created}, skipped={autoFillResult.skipped}
                            {autoFillResult.reason ? `, reason=${autoFillResult.reason}` : ''}
                          </span>
                        ) : (
                          <span>エラー: {autoFillResult.error}</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
                </fieldset>
                </div>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <WeekGrid
                  dayLabels={dayLabels}
                  data={data}
                  weekStart={weekStart}
                  monthWeekTabs={monthWeekTabs}
                  apiKind={apiKind}
                  hasScheduleEditPermission={hasScheduleEditPermission}
                  onOpenDailySiteRegistration={openDailySiteRegistration}
                  gridLayout={gridLayout}
                  nameColW={nameColW}
                  cellMinW={cellMinW}
                  cellMinHCompact={cellMinHCompact}
                  cellMinHComfortable={cellMinHComfortable}
                  cellBg={cellBg}
                  onStartNameColResize={startNameColResize}
                  onSelectWeekStart={setWeekStartByDate}
                  onPrevMonth={goPrevMonth}
                  onNextMonth={goNextMonth}
                  onToday={() => setCursorDate(new Date())}
                  allSites={sites}
                  selectedSite={selectedSite}
                  resolveSiteReference={resolveSiteReference}
                  paceTargetDays={weekVisiblePaceTargets}
                  paceTargetUserId={effectiveAutoFillUserId}
                  onEnsureSite={ensureSelectedSite}
                  onOpenSiteFromCell={openSiteDetailFromCell}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  isEditable={editActive}
                  currentUserId={authMeUser?.id ?? null}
                  currentEditorLabel={currentEditorLabel}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onNotify={showCellActionMsg}
                  onCellHistory={pushHistory}
                  onPreviewCellChange={updateVisibleCell}
                  historyHover={historyHover}
                  onAssigned={async () => {
                    if (selectedSite?.label) {
                      pinSiteLabelRef.current = selectedSite.label;
                      pinSiteToTop(selectedSite);
                    }
                    void refreshCurrentView();
                    void refreshSites();
                  }}
                  userOrder={userOrder}
                  reorderMode={reorderMode}
                  onMoveUser={(userId, dir) => {
                    persistUserOrderChange((cur) => {
                      const next = moveUserOrder(cur, userId, dir);
                      return next;
                    });
                  }}
                  onDeleteUser={deleteUser}
                  onCreateUser={createUser}
                  draggedSite={draggedSite}
                  selectedCell={selectedCell}
                  onSetSelectedCell={setSelectedCell}
                  draggedCell={draggedCell}
                  onSetDraggedCell={setDraggedCell}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  editingInput={editingInput}
                  setEditingInput={setEditingInput}
                  siteSuggestions={siteSuggestions}
                  setSiteSuggestions={setSiteSuggestions}
                  suggestionLoading={suggestionLoading}
                />
              </div>
            </>
          ) : mode === 'month' ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black lg:sticky lg:top-[calc(var(--app-header-h)+var(--mode-tabs-h,0px))] lg:max-h-[calc(100vh-var(--app-header-h)-var(--mode-tabs-h,0px))] lg:self-start lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
                <div onWheel={onSiteBannerWheel}>
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    現場を選択 → 月表のセルをクリックで入力
                  </div>

                  <div className="mt-3 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">現場（既存/新規）</div>
                    <div className="mt-1 flex gap-2">
                      <input
                        ref={siteQuickInputRef}
                        value={siteQuickInput}
                        onInput={handleSiteQuickInput}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          void pickSiteFromInput();
                        }}
                        placeholder="例: ○○現場  または  会社 / ○○現場"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <button
                        type="button"
                        onClick={() => void pickSiteFromInput()}
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        選択
                      </button>
                    </div>
                    {siteQuickMsg ? (
                      <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">{siteQuickMsg}</div>
                    ) : null}
                  </div>
                </div>

                <div
                  ref={sitePaneScrollRef}
                  className="mt-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400">バッジ月（償却）</div>
                    <input
                      type="month"
                      value={deprMonth}
                      onChange={(e) => setDeprMonthForCurrentKind(e.target.value)}
                      className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">検索</div>
                    <input
                      value={siteQuery}
                      onInput={handleSiteQueryInput}
                      placeholder="現場名で絞り込み"
                      className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div
                    className="mt-2 min-h-48 max-h-96 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-black lg:min-h-0 lg:flex-1 lg:max-h-none"
                  >
                    {sites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        まだ候補がありません（過去データから自動で出ます）。
                      </div>
                    ) : visibleSites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません。</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleSites.map((s) => {
                          const active = selectedSite?.label === s.label;
                          const badge = s.id ? siteDeprMap[s.id] : undefined;
                          const searchHighlighted = hasSiteQuery;
                          const siteColor = resolveSiteLabelColor(s, 'default');
                          return (
                            <button
                              key={s.id ?? s.label}
                              type="button"
                              data-site-id={s.id ?? undefined}
                              draggable={editActive}
                              onDragStart={(e) => {
                                if (!editActive) return;
                                setDraggedSite(s);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onDragEnd={() => setDraggedSite(null)}
                              onClick={() => {
                                if (active && s.id) {
                                  const sp = new URLSearchParams({ kind: scheduleKind });
                                  if (selectedUserId) sp.set('userId', selectedUserId);
                                  router.push(`/site-ledger/${encodeURIComponent(s.id)}?${sp.toString()}`);
                                  return;
                                }
                                setSelectedSite(s);
                              }}
                              className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                                searchHighlighted
                                  ? siteSearchHighlightClass(siteColor)
                                  : active
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              } ${active ? 'font-medium outline outline-1 outline-zinc-300 dark:outline-zinc-600' : ''} ${editActive ? 'cursor-move' : ''}`}
                              style={searchHighlighted ? siteSearchHighlightStyle(siteColor) : undefined}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex flex-1 items-center gap-1">
                                  <span className="truncate">
                                    {s.label.includes(' / ') ? s.label.split(' / ').slice(1).join(' / ') : s.label}
                                  </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {s.invoiceIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 dark:bg-red-600"
                                      title="請求未発行"
                                    />
                                  ) : null}
                                  {s.reportIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-500 dark:bg-yellow-600"
                                      title="報告未発行"
                                    />
                                  ) : null}
                                  {s.unassignedThisMonth ? (
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500 dark:bg-green-600"
                                      title="未配置"
                                    />
                                  ) : null}
                                  {badge ? (
                                    <span
                                      className={depreciationBadgeClass(badge.alert)}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!s.id) return;
                                        setSelectedSite(s);
                                        setSiteDetailOpen(true);
                                      }}
                                      title={`今月(${deprMonth}): ${badge.count}件 / 月回数 ${badge.threshold}`}
                                    >
                                      {badge.count}
                                    </span>
                                  ) : null}
                                  {s.label.includes('!') ? (
                                    <span className="ml-2 text-red-600 dark:text-red-400">!</span>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    選択中: {selectedSite?.label ?? '（なし）'}
                  </div>

                  {selectedSite?.id ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#punch`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        打刻
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#photos`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        写真
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    選択中の現場をもう一度クリックで詳細へ
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <MonthGrid
                  monthKey={viewMonth}
                  onPrevMonth={goPrevMonth}
                  onNextMonth={goNextMonth}
                  onToday={() => setWeekStartByDate(new Date())}
                  dayLabels={monthDayLabels}
                  data={monthData}
                  apiKind={apiKind}
                  gridLayout={gridLayout}
                  nameColW={nameColW}
                  cellMinW={cellMinW}
                  cellMinHCompact={cellMinHCompact}
                  cellMinHComfortable={cellMinHComfortable}
                  cellBg={cellBg}
                  onStartNameColResize={startNameColResize}
                  allSites={sites}
                  selectedSite={selectedSite}
                  resolveSiteReference={resolveSiteReference}
                  paceTargetDays={monthVisiblePaceTargets}
                  paceTargetUserId={effectiveAutoFillUserId}
                  onEnsureSite={ensureSelectedSite}
                  onOpenSiteFromCell={openSiteDetailFromCell}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  isEditable={editActive}
                  currentUserId={authMeUser?.id ?? null}
                  currentEditorLabel={currentEditorLabel}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onNotify={showCellActionMsg}
                  onCellHistory={pushHistory}
                  onPreviewCellChange={updateVisibleCell}
                  historyHover={historyHover}
                  onAssigned={async () => {
                    if (selectedSite?.label) {
                      pinSiteLabelRef.current = selectedSite.label;
                      pinSiteToTop(selectedSite);
                    }
                    void refreshCurrentView();
                    void refreshSites();
                  }}
                  userOrder={userOrder}
                  reorderMode={reorderMode}
                  onMoveUser={(userId, dir) => {
                    persistUserOrderChange((cur) => {
                      const next = moveUserOrder(cur, userId, dir);
                      return next;
                    });
                  }}
                  onDeleteUser={deleteUser}
                  onCreateUser={createUser}
                />
              </div>
            </>
          ) : mode === 'year' ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black lg:sticky lg:top-[calc(var(--app-header-h)+var(--mode-tabs-h,0px))] lg:max-h-[calc(100vh-var(--app-header-h)-var(--mode-tabs-h,0px))] lg:self-start lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">年予定（サマリ）</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{viewYear}年</div>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    従業員×12ヶ月。各セルは「日数 / 件数」です（セルクリックで月予定へ）。
                  </div>
                </div>

                <div
                  ref={sitePaneScrollRef}
                  className="mt-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400">バッジ月（償却）</div>
                    <input
                      type="month"
                      value={deprMonth}
                      onChange={(e) => setDeprMonthForCurrentKind(e.target.value)}
                      className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">検索</div>
                    <input
                      value={siteQuery}
                      onInput={handleSiteQueryInput}
                      placeholder="現場名で絞り込み"
                      className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">現場を選択 → 同じ現場を再クリックで詳細へ</div>

                  <div className="mt-3 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">現場（既存/新規）</div>
                    <div className="mt-1 flex gap-2">
                      <input
                        ref={siteQuickInputRef}
                        value={siteQuickInput}
                        onInput={handleSiteQuickInput}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          void pickSiteFromInput();
                        }}
                        placeholder="例: ○○現場  または  会社 / ○○現場"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <button
                        type="button"
                        onClick={() => void pickSiteFromInput()}
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        選択
                      </button>
                    </div>
                    {siteQuickMsg ? (
                      <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">{siteQuickMsg}</div>
                    ) : null}
                  </div>

                  <div className="mt-3 min-h-48 max-h-96 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-black lg:min-h-0 lg:flex-1 lg:max-h-none">
                    {sites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        まだ候補がありません（過去データから自動で出ます）。
                      </div>
                    ) : visibleSites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません。</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleSites.map((s) => {
                          const active = selectedSite?.label === s.label;
                          const badge = s.id ? siteDeprMap[s.id] : undefined;
                          const searchHighlighted = hasSiteQuery;
                          const siteColor = resolveSiteLabelColor(s, 'default');
                          return (
                            <button
                              key={s.id ?? s.label}
                              type="button"
                              data-site-id={s.id ?? undefined}
                              draggable={editActive}
                              onDragStart={(e) => {
                                if (!editActive) return;
                                setDraggedSite(s);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onDragEnd={() => setDraggedSite(null)}
                              onClick={() => {
                                if (active && s.id) {
                                  const sp = new URLSearchParams({ kind: scheduleKind });
                                  if (selectedUserId) sp.set('userId', selectedUserId);
                                  router.push(`/site-ledger/${encodeURIComponent(s.id)}?${sp.toString()}`);
                                  return;
                                }
                                setSelectedSite(s);
                              }}
                              className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                                searchHighlighted
                                  ? siteSearchHighlightClass(siteColor)
                                  : active
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              } ${active ? 'font-medium outline outline-1 outline-zinc-300 dark:outline-zinc-600' : ''} ${editActive ? 'cursor-move' : ''}`}
                              style={searchHighlighted ? siteSearchHighlightStyle(siteColor) : undefined}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex flex-1 items-center gap-1">
                                  <span className="truncate">
                                    {s.label.includes(' / ') ? s.label.split(' / ').slice(1).join(' / ') : s.label}
                                  </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {s.invoiceIssuedThisMonth === false ? (
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 dark:bg-red-600" title="請求未発行" />
                                  ) : null}
                                  {s.reportIssuedThisMonth === false ? (
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-500 dark:bg-yellow-600" title="報告未発行" />
                                  ) : null}
                                  {s.unassignedThisMonth ? (
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500 dark:bg-green-600" title="未配置" />
                                  ) : null}
                                  {badge ? (
                                    <span
                                      className={depreciationBadgeClass(badge.alert)}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!s.id) return;
                                        setSelectedSite(s);
                                        setSiteDetailOpen(true);
                                      }}
                                      title={`今月(${deprMonth}): ${badge.count}件 / 月回数 ${badge.threshold}`}
                                    >
                                      {badge.count}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    選択中: {selectedSite?.label ?? '（なし）'}
                  </div>
                </div>

                  {selectedSite?.id ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#punch`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        打刻
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#photos`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        写真
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <YearGrid
                  data={yearData}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onOpenMonth={openMonthFromYear}
                  userOrder={userOrder}
                  reorderMode={reorderMode}
                  gridLayout={gridLayout}
                  nameColW={nameColW}
                  cellMinW={cellMinW}
                  cellMinHCompact={cellMinHCompact}
                  cellMinHComfortable={cellMinHComfortable}
                  cellBg={cellBg}
                  onStartNameColResize={startNameColResize}
                  onMoveUser={(userId, dir) => {
                    persistUserOrderChange((cur) => {
                      const next = moveUserOrder(cur, userId, dir);
                      return next;
                    });
                  }}
                  onDeleteUser={deleteUser}
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {modeTabs}
              <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                表示モードが不明です。上のタブから選択してください。
              </div>
            </div>
          )}
        </div>

        {siteDetailOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="close"
              onClick={() => setSiteDetailOpen(false)}
              className="absolute inset-0 bg-black/40"
            />

            <div className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">現場詳細</div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {selectedSite?.label ?? '（未選択）'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSiteDetailOpen(false)}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  閉じる
                </button>
              </div>

              {!hasScheduleEditPermission ? (
                <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                  この現場の編集は、編集権限保持者のみ利用できます。
                </div>
              ) : null}

              <fieldset disabled={!hasScheduleEditPermission} className={!hasScheduleEditPermission ? 'opacity-60' : ''}>
              <div className="mt-4 rounded-md border border-zinc-200 bg-white px-3 py-3 text-xs dark:border-zinc-800 dark:bg-black">
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">担当者</div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  自動入力の対象にも使います（従業員名/メールに一致した場合）。
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={contactNameInput}
                    onChange={(e) => {
                      setContactSaveMsg(null);
                      setContactNameInput(e.target.value);
                    }}
                    placeholder="例: 山田太郎"
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                  <button
                    type="button"
                    disabled={!selectedSite?.id || isSavingContact}
                    onClick={async () => {
                      if (!selectedSite?.id) return;
                      setContactSaveMsg(null);

                      const v = contactNameInput.trim();
                      setIsSavingContact(true);
                      try {
                        const r = await fetch('/api/sites', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ id: selectedSite.id, contactName: v || null }),
                        });

                        const json = (await r.json().catch(() => null)) as
                          | { ok: true }
                          | { ok: false; error?: string }
                          | null;

                        if (!r.ok || !json || !json.ok) {
                          setContactSaveMsg((json && !json.ok ? json.error : undefined) || `HTTP ${r.status}`);
                          return;
                        }

                        setContactSaveMsg('保存しました');
                      } catch {
                        setContactSaveMsg('保存に失敗しました');
                      } finally {
                        setIsSavingContact(false);
                      }
                    }}
                    className="shrink-0 rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  >
                    {isSavingContact ? '保存中…' : '保存'}
                  </button>
                </div>

                {contactSaveMsg ? (
                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{contactSaveMsg}</div>
                ) : null}
              </div>

              <div className="mt-4 rounded-md border border-zinc-200 bg-white px-3 py-3 text-xs dark:border-zinc-800 dark:bg-black">
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">償却カウント</div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  指定月に、この現場の入力件数を集計します（月回数以上でアラート）。
                </div>

                <div className="mt-2">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">対象月</div>
                  <input
                    type="month"
                    value={deprMonth}
                    onChange={(e) => setDeprMonthForCurrentKind(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                </div>

                <div className="mt-2">
                  {deprState.status === 'idle' || deprState.status === 'loading' ? (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
                  ) : deprState.status === 'error' ? (
                    <div className="text-xs text-red-700 dark:text-red-300">{deprState.message}</div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm tabular-nums text-zinc-900 dark:text-zinc-50">
                        {deprState.count}件
                      </div>
                      {deprState.alert ? (
                        <div className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] text-red-700 dark:border-red-900 dark:bg-black dark:text-red-300">
                          アラート: {deprState.threshold}件以上
                        </div>
                      ) : (
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">OK</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    アラート月回数（現場ごと）
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    例: 10 → 10件以上でアラート
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <input
                      inputMode="numeric"
                      value={deprThresholdInput}
                      onChange={(e) => setDeprThresholdInput(e.target.value)}
                      className="w-28 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
                      placeholder="10"
                    />
                    <button
                      type="button"
                      disabled={!selectedSite?.id}
                      onClick={async () => {
                        if (!selectedSite?.id) return;
                        setDeprSaveMsg(null);

                        const n = Number(deprThresholdInput);
                        if (!Number.isFinite(n) || n < 1 || n > 999) {
                          setDeprSaveMsg('1〜999の数値で入力してください');
                          return;
                        }

                        try {
                          const r = await fetch('/api/sites', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ id: selectedSite.id, depreciationThreshold: n }),
                          });

                          const json = (await r.json().catch(() => null)) as
                            | { ok: true }
                            | { ok: false; error?: string }
                            | null;

                          if (!r.ok || !json || !json.ok) {
                            setDeprSaveMsg((json && !json.ok ? json.error : undefined) || `HTTP ${r.status}`);
                            return;
                          }

                          setDeprSaveMsg('保存しました');

                          // Update local badge + modal state
                          setSiteDeprMap((cur) => {
                            const prev = cur[selectedSite.id!];
                            return prev
                              ? { ...cur, [selectedSite.id!]: { ...prev, threshold: n, alert: prev.count >= n } }
                              : cur;
                          });

                          setDeprState((s) =>
                            s.status === 'ok' ? { ...s, threshold: n, alert: s.count >= n } : s,
                          );
                        } catch {
                          setDeprSaveMsg('保存に失敗しました');
                        }
                      }}
                      className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      保存
                    </button>
                  </div>

                  {deprSaveMsg ? (
                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{deprSaveMsg}</div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                現場ID: {selectedSite?.id ?? '（なし）'}
                {selectedSiteCreatedAt ? ` / 作成: ${String(selectedSiteCreatedAt).slice(0, 10)}` : ''}
              </div>
              </fieldset>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WeekGrid({
  dayLabels,
  data,
  weekStart,
  monthWeekTabs,
  apiKind,
  hasScheduleEditPermission,
  onOpenDailySiteRegistration,
  gridLayout,
  nameColW,
  cellMinW,
  cellMinHCompact,
  cellMinHComfortable,
  cellBg,
  onStartNameColResize,
  onSelectWeekStart,
  onPrevMonth,
  onNextMonth,
  onToday,
  allSites,
  selectedSite,
  resolveSiteReference,
  paceTargetDays,
  paceTargetUserId,
  onEnsureSite,
  onOpenSiteFromCell,
  cellClickAction,
  cellTextColor,
  isEditable,
  currentUserId,
  currentEditorLabel,
  selectedUserId,
  onSelectUser,
  onNotify,
  onCellHistory,
  onPreviewCellChange,
  onAssigned,
  historyHover,
  userOrder,
  reorderMode,
  onMoveUser,
  onDeleteUser,
  onCreateUser,
  draggedSite,
  selectedCell,
  onSetSelectedCell,
  draggedCell,
  onSetDraggedCell,
  editingCell,
  setEditingCell,
  editingInput,
  setEditingInput,
  siteSuggestions,
  setSiteSuggestions,
  suggestionLoading,
}: {
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  data: ApiResponse | null;
  weekStart: Date;
  monthWeekTabs: { monthKey: string; tabs: Date[] };
  apiKind: 'NORMAL' | 'DAILY';
  hasScheduleEditPermission: boolean;
  onOpenDailySiteRegistration: () => void;
  gridLayout: GridLayout;
  nameColW: number;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
  cellBg: CellBg;
  onStartNameColResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelectWeekStart: (d: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  allSites: SiteItem[];
  selectedSite: SiteItem | null;
  resolveSiteReference: (input: { siteId?: string | null; siteName?: string | null }) => SiteItem | null;
  paceTargetDays: ReadonlySet<string>;
  paceTargetUserId: string | null;
  onEnsureSite: () => Promise<SiteItem | null>;
  onOpenSiteFromCell: (siteName: string, focusCell?: WeekHubEditingCellState | null) => void;
  cellClickAction: CellClickAction;
  cellTextColor: CellTextColor;
  isEditable: boolean;
  currentUserId: string | null;
  currentEditorLabel: string;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onPreviewCellChange?: (input: { userId: string; day: string; cell: ApiCell }) => void;
  onAssigned: () => void | Promise<void>;
  historyHover: { userId: string; day: string } | null;
  userOrder: string[];
  reorderMode: boolean;
  onMoveUser: (userId: string, dir: -1 | 1) => void;
  onDeleteUser: (userId: string) => void | Promise<void>;
  onCreateUser: (
    input: { name: string; email: string },
  ) => Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
  draggedSite: SiteItem | null;
  selectedCell: WeekHubSelectedCellState | null;
  onSetSelectedCell: (cell: WeekHubSelectedCellState | null) => void;
  draggedCell: DraggedCellState | null;
  onSetDraggedCell: (cell: DraggedCellState | null) => void;
  editingCell: WeekHubEditingCellState | null;
  setEditingCell: (cell: WeekHubEditingCellState | null) => void;
  editingInput: string;
  setEditingInput: (value: string) => void;
  siteSuggestions: SiteItem[];
  setSiteSuggestions: (suggestions: SiteItem[]) => void;
  suggestionLoading: boolean;
}) {
  const users = useMemo(() => orderUsers(data?.users ?? [], userOrder), [data?.users, userOrder]);
  const grid = data?.grid ?? {};
  const activeWeekKey = toYmd(weekStart);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<0 | 1>(0);

  const cellMinH = useMemo(() => {
    return gridLayout === 'comfortable' ? cellMinHComfortable : cellMinHCompact;
  }, [cellMinHCompact, cellMinHComfortable, gridLayout]);
  const nameColumnTrack = useMemo(() => buildNameColumnTrack(nameColW), [nameColW]);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  const syncScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onHeaderScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(headerScrollRef.current, scrollRootRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  const onBodyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(scrollRootRef.current, headerScrollRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
      data-testid="week-grid"
    >
      <div className="sticky z-40" style={{ top: 'calc(var(--app-header-h) + var(--mode-tabs-h, 0px))' }}>
        {/* Week switch tabs: sticky stack top row */}
        <div className="border-b border-zinc-400 bg-white/90 px-2 py-2 text-xs backdrop-blur dark:border-zinc-600 dark:bg-black/90">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onPrevMonth}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="前の月"
              >
                ←
              </button>

              <div className="flex items-center gap-1 overflow-x-auto rounded-md border border-zinc-200 bg-white/60 px-2 py-1 dark:border-zinc-800 dark:bg-black/60">
                {monthWeekTabs.tabs.map((t) => {
                  const k = toYmd(t);
                  const active = k === activeWeekKey;
                  const label = `${t.getMonth() + 1}/${t.getDate()}`;
                  return (
                    <button
                      key={k}
                      type="button"
                      data-week-switch-tab="true"
                      onClick={() => onSelectWeekStart(t)}
                      className={`rounded-md border px-2 py-1 text-[11px] tabular-nums ${
                        active
                          ? 'border-red-500 bg-red-100 font-semibold text-red-700 shadow-sm dark:border-red-500 dark:bg-red-900/40 dark:text-red-300'
                          : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                      }`}
                      aria-current={active ? 'true' : undefined}
                      title={k}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={onNextMonth}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="次の月"
              >
                →
              </button>
            </div>

            <div className="flex items-center gap-2">
              {apiKind === 'DAILY' ? (
                <button
                  type="button"
                  onClick={onOpenDailySiteRegistration}
                  disabled={!hasScheduleEditPermission}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  title={hasScheduleEditPermission ? '日常現場を管理画面で登録' : '編集権限が必要です'}
                >
                  日常現場登録
                </button>
              ) : null}

              <button
                type="button"
                onClick={onToday}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                今週
              </button>
            </div>
          </div>
        </div>

        {/* Date header row: sticky stack second row */}
        <div className="border-b border-zinc-400 dark:border-zinc-600">
          <div
            ref={headerScrollRef}
            className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
            onScroll={onHeaderScroll}
            data-testid="week-grid-header-scroll"
          >
            <div
              className="grid"
              style={{
                gridTemplateColumns: `${nameColumnTrack} repeat(7, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
              }}
            >
              <div className="sticky left-0 z-40 border-r border-zinc-400 bg-white px-2 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-600 dark:bg-black dark:text-zinc-300 relative sm:px-3">
                <ColumnResizeHandle onPointerDown={onStartNameColResize} />
              </div>
              {dayLabels.map((d) => (
                <div
                  key={d.key}
                  className={`pointer-events-none border-l border-zinc-400 bg-white px-2 py-2 text-xs font-medium dark:border-zinc-600 dark:bg-black ${
                    d.isSun
                      ? 'text-red-600 dark:text-red-400'
                      : d.isSat
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span className="tabular-nums">{d.dayNum}</span>
                    <span>{d.dow}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Body: horizontal scroll */}
      <div
        ref={scrollRootRef}
        className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
        onScroll={onBodyScroll}
        data-testid="week-grid-body-scroll"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${nameColumnTrack} repeat(7, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
          }}
        >
          {users.length === 0 ? (
            <div className="col-span-8 px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400">
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u, idx) => {
              const isSelectedUser = selectedUserId === u.id;
              const baseBg = cellBg === 'soft' ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black';
              const selectedBg = 'bg-zinc-50 dark:bg-zinc-950';
              return (
                <Row
                  key={u.id}
                  user={u}
                  allUsers={users}
                  allSites={allSites}
                  dayLabels={dayLabels}
                  allGrid={grid}
                  grid={grid[u.id] ?? {}}
                  apiKind={apiKind}
                  selectedSite={selectedSite}
                  resolveSiteReference={resolveSiteReference}
                  paceTargetDays={paceTargetDays}
                  paceTargetUserId={paceTargetUserId}
                  onEnsureSite={onEnsureSite}
                  onOpenSiteFromCell={onOpenSiteFromCell}
                  selectedUserId={selectedUserId}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  gridLayout={gridLayout}
                  cellMinH={cellMinH}
                  isEditable={isEditable}
                  currentUserId={currentUserId}
                  currentEditorLabel={currentEditorLabel}
                  onSelectUser={onSelectUser}
                  onNotify={onNotify}
                  onCellHistory={onCellHistory}
                  onPreviewCellChange={onPreviewCellChange}
                  onAssigned={onAssigned}
                  historyHover={historyHover}
                  reorderMode={reorderMode}
                  moveUpDisabled={idx === 0}
                  moveDownDisabled={idx === users.length - 1}
                  onMoveUp={() => onMoveUser(u.id, -1)}
                  onMoveDown={() => onMoveUser(u.id, 1)}
                  onDeleteUser={() => onDeleteUser(u.id)}
                  onStartNameColResize={onStartNameColResize}
                  rowCellClassName={isSelectedUser ? selectedBg : baseBg}
                  draggedSite={draggedSite}
                  selectedCell={selectedCell}
                  onSetSelectedCell={onSetSelectedCell}
                  draggedCell={draggedCell}
                  onSetDraggedCell={onSetDraggedCell}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  editingInput={editingInput}
                  setEditingInput={setEditingInput}
                  siteSuggestions={siteSuggestions}
                  setSiteSuggestions={setSiteSuggestions}
                  suggestionLoading={suggestionLoading}
                />
              );
            })
          )}

          {isEditable ? <AddUserRow dayLabels={dayLabels} cellMinH={cellMinH} onCreateUser={onCreateUser} /> : null}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  monthKey,
  onPrevMonth,
  onNextMonth,
  onToday,
  dayLabels,
  data,
  apiKind,
  gridLayout,
  nameColW,
  cellMinW,
  cellMinHCompact,
  cellMinHComfortable,
  cellBg,
  onStartNameColResize,
  allSites,
  selectedSite,
  resolveSiteReference,
  paceTargetDays,
  paceTargetUserId,
  onEnsureSite,
  onOpenSiteFromCell,
  cellClickAction,
  cellTextColor,
  isEditable,
  currentUserId,
  currentEditorLabel,
  selectedUserId,
  onSelectUser,
  onNotify,
  onCellHistory,
  onPreviewCellChange,
  onAssigned,
  historyHover,
  userOrder,
  reorderMode,
  onMoveUser,
  onDeleteUser,
  onCreateUser,
}: {
  monthKey: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  data: MonthApiResponse | null;
  apiKind: 'NORMAL' | 'DAILY';
  gridLayout: GridLayout;
  nameColW: number;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
  cellBg: CellBg;
  onStartNameColResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  allSites: SiteItem[];
  selectedSite: SiteItem | null;
  resolveSiteReference: (input: { siteId?: string | null; siteName?: string | null }) => SiteItem | null;
  paceTargetDays: ReadonlySet<string>;
  paceTargetUserId: string | null;
  onEnsureSite: () => Promise<SiteItem | null>;
  onOpenSiteFromCell: (siteName: string, focusCell?: WeekHubEditingCellState | null) => void;
  cellClickAction: CellClickAction;
  cellTextColor: CellTextColor;
  isEditable: boolean;
  currentUserId: string | null;
  currentEditorLabel: string;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onPreviewCellChange?: (input: { userId: string; day: string; cell: ApiCell }) => void;
  onAssigned: () => void | Promise<void>;
  historyHover: { userId: string; day: string } | null;
  userOrder: string[];
  reorderMode: boolean;
  onMoveUser: (userId: string, dir: -1 | 1) => void;
  onDeleteUser: (userId: string) => void | Promise<void>;
  onCreateUser: (
    input: { name: string; email: string },
  ) => Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
}) {
  const users = useMemo(() => orderUsers(data?.users ?? [], userOrder), [data?.users, userOrder]);
  const grid = data?.grid ?? {};
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const topScrollbarRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<0 | 1>(0);
  const [topScrollbarMetrics, setTopScrollbarMetrics] = useState({ contentWidth: 0, viewportWidth: 0 });

  const cellMinH = useMemo(() => {
    return gridLayout === 'comfortable' ? cellMinHComfortable : cellMinHCompact;
  }, [cellMinHCompact, cellMinHComfortable, gridLayout]);
  const nameColumnTrack = useMemo(() => buildNameColumnTrack(nameColW), [nameColW]);

  useEffect(() => {
    const body = scrollRootRef.current;
    const content = body?.firstElementChild;
    if (!body || !(content instanceof HTMLElement)) return;

    const apply = () => {
      const next = {
        contentWidth: body.scrollWidth,
        viewportWidth: body.clientWidth,
      };
      setTopScrollbarMetrics((prev) =>
        prev.contentWidth === next.contentWidth && prev.viewportWidth === next.viewportWidth ? prev : next,
      );
    };

    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(body);
    ro.observe(content);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [monthKey, users.length]);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  const syncScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onHeaderScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(headerScrollRef.current, scrollRootRef.current);
    syncScrollLeft(headerScrollRef.current, topScrollbarRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  const onBodyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(scrollRootRef.current, headerScrollRef.current);
    syncScrollLeft(scrollRootRef.current, topScrollbarRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  const onTopScrollbarScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(topScrollbarRef.current, headerScrollRef.current);
    syncScrollLeft(topScrollbarRef.current, scrollRootRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
      data-testid="month-grid"
    >
      <div className="sticky z-40" style={{ top: 'calc(var(--app-header-h) + var(--mode-tabs-h, 0px))' }}>
        {/* Month switch: sticky stack top row */}
        <div className="border-b border-zinc-400 bg-white/90 px-2 py-2 text-xs backdrop-blur dark:border-zinc-600 dark:bg-black/90">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onPrevMonth}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="前の月"
              >
                ←
              </button>
              <div className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{monthKey}</div>
              <button
                type="button"
                onClick={onNextMonth}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="次の月"
              >
                →
              </button>
            </div>

            <button
              type="button"
              onClick={onToday}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              今月
            </button>
          </div>
        </div>

        {topScrollbarMetrics.contentWidth > topScrollbarMetrics.viewportWidth ? (
          <div className="border-b border-zinc-400 bg-white/90 px-2 py-1 dark:border-zinc-600 dark:bg-black/90">
            <div
              ref={topScrollbarRef}
              className="mh-scrollbar-visible h-5 overflow-x-auto overflow-y-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800/80"
              onScroll={onTopScrollbarScroll}
              data-testid="month-grid-top-scrollbar"
            >
              <div style={{ width: `${topScrollbarMetrics.contentWidth}px`, height: '1px' }} />
            </div>
          </div>
        ) : null}

        {/* Date header row: sticky stack second row */}
        <div className="border-b border-zinc-400 dark:border-zinc-600">
          <div
            ref={headerScrollRef}
            className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
            onScroll={onHeaderScroll}
            data-testid="month-grid-header-scroll"
          >
            <div
              className="grid"
              style={{
                gridTemplateColumns: `${nameColumnTrack} repeat(${Math.max(dayLabels.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
              }}
            >
              <div className="sticky left-0 z-40 border-r border-zinc-400 bg-white px-2 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-600 dark:bg-black dark:text-zinc-300 relative sm:px-3">
                <ColumnResizeHandle onPointerDown={onStartNameColResize} />
              </div>
              {dayLabels.map((d) => (
                <div
                  key={d.key}
                  className={`pointer-events-none border-l border-zinc-400 bg-white px-2 py-2 text-xs font-medium dark:border-zinc-600 dark:bg-black ${
                    d.isSun
                      ? 'text-red-600 dark:text-red-400'
                      : d.isSat
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span className="tabular-nums">{d.dayNum}</span>
                    <span>{d.dow}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Body: horizontal scroll */}
      <div
        ref={scrollRootRef}
        className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
        onScroll={onBodyScroll}
        data-testid="month-grid-body-scroll"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${nameColumnTrack} repeat(${Math.max(dayLabels.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
          }}
        >
          {users.length === 0 ? (
            <div
              className="px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400"
              style={{ gridColumn: `span ${Math.max(dayLabels.length + 1, 2)}` }}
            >
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u, idx) => {
              const isSelectedUser = selectedUserId === u.id;
              const baseBg = cellBg === 'soft' ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black';
              const selectedBg = 'bg-zinc-50 dark:bg-zinc-950';
              return (
                <Row
                  key={u.id}
                  user={u}
                  allUsers={users}
                  allSites={allSites}
                  dayLabels={dayLabels}
                  allGrid={grid}
                  grid={grid[u.id] ?? {}}
                  apiKind={apiKind}
                  selectedSite={selectedSite}
                  resolveSiteReference={resolveSiteReference}
                  paceTargetDays={paceTargetDays}
                  paceTargetUserId={paceTargetUserId}
                  onEnsureSite={onEnsureSite}
                  onOpenSiteFromCell={onOpenSiteFromCell}
                  selectedUserId={selectedUserId}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  gridLayout={gridLayout}
                  cellMinH={cellMinH}
                  isEditable={isEditable}
                  currentUserId={currentUserId}
                  currentEditorLabel={currentEditorLabel}
                  onSelectUser={onSelectUser}
                  onNotify={onNotify}
                  onCellHistory={onCellHistory}
                  onPreviewCellChange={onPreviewCellChange}
                  onAssigned={onAssigned}
                  historyHover={historyHover}
                  reorderMode={reorderMode}
                  moveUpDisabled={idx === 0}
                  moveDownDisabled={idx === users.length - 1}
                  onMoveUp={() => onMoveUser(u.id, -1)}
                  onMoveDown={() => onMoveUser(u.id, 1)}
                  onDeleteUser={() => onDeleteUser(u.id)}
                  onStartNameColResize={onStartNameColResize}
                  rowCellClassName={isSelectedUser ? selectedBg : baseBg}
                  draggedSite={null}
                />
              );
            })
          )}

          {isEditable ? <AddUserRow dayLabels={dayLabels} cellMinH={cellMinH} onCreateUser={onCreateUser} /> : null}
        </div>
      </div>
    </div>
  );
}

function AddUserRow({
  dayLabels,
  cellMinH,
  onCreateUser,
}: {
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  cellMinH: number;
  onCreateUser: (
    input: { name: string; email: string },
  ) => Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div
        className="sticky left-0 z-10 border-b border-r border-zinc-400 bg-white px-2 py-2 text-left text-[12px] dark:border-zinc-600 dark:bg-black"
        style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}
      >
        <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">従業員追加</div>
        <div className="mt-1 flex flex-col gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名前"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-800 dark:bg-black"
            disabled={busy}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メール（任意）"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-800 dark:bg-black"
            disabled={busy}
          />
          <button
            type="button"
            onClick={async () => {
              setMsg(null);
              if (busy) return;
              setBusy(true);
              try {
                const r = await onCreateUser({ name, email });
                if (!r.ok) {
                  setMsg(r.error);
                  return;
                }
                setName('');
                setEmail('');
                setMsg('追加しました');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || (!name.trim() && !email.trim())}
            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
          >
            {busy ? '追加中…' : '追加'}
          </button>
          {msg ? <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{msg}</div> : null}
        </div>
      </div>
      {dayLabels.map((d) => (
        <div
          key={`add-user-${d.key}`}
          className="border-b border-l border-zinc-200 bg-white px-2 py-2 text-left text-xs dark:border-zinc-800 dark:bg-black"
          style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}
        />
      ))}
    </>
  );
}

function YearGrid({
  data,
  selectedUserId,
  onSelectUser,
  onOpenMonth,
  userOrder,
  reorderMode,
  gridLayout,
  nameColW,
  cellMinW,
  cellMinHCompact,
  cellMinHComfortable,
  cellBg,
  onStartNameColResize,
  onMoveUser,
  onDeleteUser,
}: {
  data: YearSummaryApiResponse | null;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onOpenMonth: (month: string, userId: string) => void;
  userOrder: string[];
  reorderMode: boolean;
  gridLayout: GridLayout;
  nameColW: number;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
  cellBg: CellBg;
  onStartNameColResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMoveUser: (userId: string, dir: -1 | 1) => void;
  onDeleteUser: (userId: string) => void | Promise<void>;
}) {
  const users = useMemo(() => orderUsers(data?.users ?? [], userOrder), [data?.users, userOrder]);
  const months = useMemo(() => data?.months ?? [], [data?.months]);
  const grid = data?.grid ?? {};
  const cellMinH = useMemo(() => {
    return gridLayout === 'comfortable' ? cellMinHComfortable : cellMinHCompact;
  }, [cellMinHCompact, cellMinHComfortable, gridLayout]);
  const nameColumnTrack = useMemo(() => buildNameColumnTrack(nameColW), [nameColW]);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<0 | 1>(0);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  const syncScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onHeaderScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(headerScrollRef.current, scrollRootRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  const onBodyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(scrollRootRef.current, headerScrollRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
      data-testid="year-grid"
    >
      <div className="sticky z-40" style={{ top: 'calc(var(--app-header-h) + var(--mode-tabs-h, 0px))' }}>
        {/* Month header row: sticky + horizontal-scroll synced */}
        <div className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
          <div
            ref={headerScrollRef}
            className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
            onScroll={onHeaderScroll}
            data-testid="year-grid-header-scroll"
          >
            <div
              className="grid"
              style={{
                gridTemplateColumns: `${nameColumnTrack} repeat(${Math.max(months.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
              }}
            >
              <div className="sticky left-0 z-40 border-r border-zinc-200 bg-white px-2 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 relative sm:px-3">
                <ColumnResizeHandle onPointerDown={onStartNameColResize} />
              </div>

              {months.map((m) => {
                const mm = Number(m.slice(-2));
                return (
                  <div
                    key={m}
                    className="pointer-events-none border-l border-zinc-200 bg-white px-2 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300"
                  >
                    <div className="flex items-center gap-1">
                      <span className="tabular-nums">{mm}</span>
                      <span>月</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Body: horizontal scroll */}
      <div
        ref={scrollRootRef}
        className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
        onScroll={onBodyScroll}
        data-testid="year-grid-body-scroll"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${nameColumnTrack} repeat(${Math.max(months.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
          }}
        >
          {users.length === 0 ? (
            <div
              className="px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400"
              style={{ gridColumn: `span ${Math.max(months.length + 1, 2)}` }}
            >
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u, idx) => {
              const isSelectedUser = selectedUserId === u.id;
              const baseBg = cellBg === 'soft' ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black';
              const selectedBg = 'bg-zinc-50 dark:bg-zinc-950';
              const sum = months.reduce(
                (acc, m) => {
                  const cell = grid[u.id]?.[m];
                  acc.days += cell?.days ?? 0;
                  acc.entries += cell?.entries ?? 0;
                  return acc;
                },
                { days: 0, entries: 0 },
              );
              return (
                <Fragment key={u.id}>
                  <div
                    key={`${u.id}-name`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectUser(isSelectedUser ? null : u.id)}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onSelectUser(isSelectedUser ? null : u.id);
                    }}
                    aria-current={isSelectedUser ? 'true' : undefined}
                    data-user-row={u.id}
                    data-testid={`user-row-${u.id}`}
                    className={`sticky left-0 z-10 border-b border-r border-zinc-200 px-1.5 py-2 text-left text-[13px] dark:border-zinc-800 relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-zinc-200 dark:after:bg-zinc-800 sm:px-2 ${
                      isSelectedUser ? selectedBg : baseBg
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2" style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.name ?? u.email ?? u.id}</div>
                        <div className="mt-0.5 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                          合計: {sum.days}日 / {sum.entries}件
                        </div>
                      </div>
                      {reorderMode ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onMoveUser(u.id, -1);
                              }}
                              className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                              aria-label="上へ"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={idx === users.length - 1}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onMoveUser(u.id, 1);
                              }}
                              className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                              aria-label="下へ"
                            >
                              ▼
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onDeleteUser(u.id);
                            }}
                            className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                            aria-label="削除"
                          >
                            削除
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <ColumnResizeHandle onPointerDown={onStartNameColResize} />
                  </div>

                  {months.map((m) => {
                    const cell = grid[u.id]?.[m] ?? { days: 0, entries: 0 };
                    return (
                      <button
                        key={`${u.id}-${m}`}
                        type="button"
                        onClick={() => onOpenMonth(m, u.id)}
                        className={`border-b border-l border-zinc-200 px-2 py-2 text-left text-xs dark:border-zinc-800 ${
                          isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : ''
                        }`}
                        title={`${m}の月予定へ（${cell.days}日 / ${cell.entries}件）`}
                        data-testid={`year-cell-${u.id}-${m}`}
                      >
                        <div style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}>
                          <div className="text-zinc-800 dark:text-zinc-200">
                            <span className="tabular-nums">{cell.days}</span>日
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            <span className="tabular-nums">{cell.entries}</span>件
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  user,
  allUsers,
  allSites,
  dayLabels,
  allGrid,
  grid,
  apiKind,
  selectedSite,
  resolveSiteReference,
  onEnsureSite,
  onOpenSiteFromCell,
  selectedUserId,
  cellClickAction,
  cellTextColor,
  gridLayout,
  cellMinH,
  isEditable,
  currentUserId,
  currentEditorLabel,
  onSelectUser,
  paceTargetDays,
  paceTargetUserId,
  onNotify,
  onCellHistory,
  onPreviewCellChange,
  onAssigned,
  historyHover,
  reorderMode,
  moveUpDisabled,
  moveDownDisabled,
  onMoveUp,
  onMoveDown,
  onDeleteUser,
  onStartNameColResize,
  rowCellClassName,
  draggedSite,
  selectedCell,
  onSetSelectedCell,
  draggedCell,
  onSetDraggedCell,
  editingCell,
  setEditingCell,
  editingInput,
  setEditingInput,
  siteSuggestions,
  setSiteSuggestions,
  suggestionLoading,
}: {
  user: ApiUser;
  allUsers: ApiUser[];
  allSites: SiteItem[];
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  allGrid: Record<string, Record<string, ApiCell>>;
  grid: Record<string, ApiCell>;
  apiKind: 'NORMAL' | 'DAILY';
  selectedSite: SiteItem | null;
  resolveSiteReference?: (input: { siteId?: string | null; siteName?: string | null }) => SiteItem | null;
  onEnsureSite?: () => Promise<SiteItem | null>;
  onOpenSiteFromCell?: (siteName: string, focusCell?: WeekHubEditingCellState | null) => void;
  selectedUserId: string | null;
  cellClickAction: CellClickAction;
  cellTextColor: CellTextColor;
  gridLayout: GridLayout;
  cellMinH: number;
  isEditable: boolean;
  currentUserId: string | null;
  currentEditorLabel: string;
  onSelectUser: (userId: string | null) => void;
  paceTargetDays?: ReadonlySet<string>;
  paceTargetUserId?: string | null;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onPreviewCellChange?: (input: { userId: string; day: string; cell: ApiCell }) => void;
  onAssigned: () => void | Promise<void>;
  historyHover: { userId: string; day: string } | null;
  reorderMode?: boolean;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDeleteUser?: () => void | Promise<void>;
  onStartNameColResize?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  rowCellClassName?: string;
  draggedSite: SiteItem | null;
  selectedCell?: WeekHubSelectedCellState | null;
  onSetSelectedCell?: (cell: WeekHubSelectedCellState | null) => void;
  draggedCell?: DraggedCellState | null;
  onSetDraggedCell?: (cell: DraggedCellState | null) => void;
  editingCell?: WeekHubEditingCellState | null;
  setEditingCell?: (cell: WeekHubEditingCellState | null) => void;
  editingInput?: string;
  setEditingInput?: (value: string) => void;
  siteSuggestions?: SiteItem[];
  setSiteSuggestions?: (suggestions: SiteItem[]) => void;
  suggestionLoading?: boolean;
}) {
  const isSelectedUser = selectedUserId === user.id;
  const isCurrentUser = currentUserId === user.id;
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const lastContextMenuWheelAtRef = useRef(0);
  const [slotContextMenu, setSlotContextMenu] = useState<SlotContextMenuState | null>(null);

  const resolveStoredSite = useCallback(
    (siteName: string) => {
      const trimmed = siteName.trim();
      if (!trimmed) return null;
      const resolved = resolveSiteReference?.({ siteName: trimmed });
      if (resolved) return resolved;
      return (
        allSites.find((site) => {
          const storedName = siteStoredName(site);
          return storedName === trimmed || site.label.trim() === trimmed;
        }) ?? null
      );
    },
    [allSites, resolveSiteReference],
  );

  const allSiteStoredNames = useMemo(
    () =>
      Array.from(
        new Set(
          allSites
            .map((site) => siteStoredName(site))
            .filter((name): name is string => typeof name === 'string' && name.trim().length > 0),
        ),
      ),
    [allSites],
  );

  const siteFamilyInfoForName = useCallback(
    (siteName: string) => findSiteFamily(siteName, allSiteStoredNames),
    [allSiteStoredNames],
  );

  const siteFamilyKeyForName = useCallback(
    (siteName: string) => siteFamilyInfoForName(siteName).key,
    [siteFamilyInfoForName],
  );

  const siteFamilyLabelForName = useCallback(
    (siteName: string) => siteFamilyInfoForName(siteName).label,
    [siteFamilyInfoForName],
  );

  const cellGroupsForDay = useCallback((day: string) => apiCellToGroups(grid[day]), [grid]);
  const siblingEntryNamesForSite = useCallback(
    (day: string, siteName: string) => {
      const exactGroup = cellGroupsForDay(day).find((group) =>
        group.items.some((entry) => entry.label === siteName),
      );
      if (exactGroup) return exactGroup.items.map((entry) => entry.label);
      return [siteName.trim()].filter(Boolean);
    },
    [cellGroupsForDay],
  );

  const closeSlotContextMenu = useCallback(() => {
    setSlotContextMenu(null);
  }, []);

  useEffect(() => {
    if (!slotContextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const menu = contextMenuRef.current;
      if (!menu) return;
      if (event.target instanceof Node && menu.contains(event.target)) return;
      setSlotContextMenu(null);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSlotContextMenu(null);
    };

    const handleClose = () => {
      setSlotContextMenu(null);
    };

    const handleScroll = (event: Event) => {
      const menu = contextMenuRef.current;
      if (Date.now() - lastContextMenuWheelAtRef.current < 250) return;
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      setSlotContextMenu(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleClose);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [slotContextMenu]);

  const assignedUserIdsForSite = useCallback(
    (day: string, siteName: string) => {
      const targetName = siteName.trim();
      if (!targetName) return [];
      return allUsers
        .filter((candidate) =>
          apiCellToSiteEntries(allGrid[candidate.id]?.[day]).some((entry) => entry.label === targetName),
        )
        .map((candidate) => candidate.id);
    },
    [allGrid, allUsers],
  );

  const openSlotContextMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      input: {
        day: string;
        siteName: string;
        color: LabelColor;
        beforeCell: ApiCell;
        groupIndex: number;
        entryKind: ScheduleCellEntryKind;
        groupNote?: string | null;
      },
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isEditable) {
        onNotify?.('編集するには、ヘッダーの「編集」から開始してください');
        return;
      }

      setSlotContextMenu({
        day: input.day,
        siteName: input.siteName,
        color: input.color,
        beforeCell: cloneApiCell(input.beforeCell),
        x: event.clientX,
        y: event.clientY,
        companyName: input.entryKind === 'site' ? siteFamilyLabelForName(input.siteName) : null,
        entryKind: input.entryKind,
        groupIndex: input.groupIndex,
        groupNote: normalizeScheduleCellNote(input.groupNote),
        mode: 'actions',
        selectedUserIds: input.entryKind === 'site' ? assignedUserIdsForSite(input.day, input.siteName) : [],
        selectedSiblingNames: input.entryKind === 'site' ? siblingEntryNamesForSite(input.day, input.siteName) : [],
        noteDraft: normalizeScheduleCellNote(input.groupNote) ?? '',
      });
    },
    [assignedUserIdsForSite, isEditable, onNotify, siblingEntryNamesForSite, siteFamilyLabelForName],
  );

  const slotContextAssignUsersDay = slotContextMenu?.mode === 'assign-users' ? slotContextMenu.day : null;
  const slotContextAssignUsersSiteName = slotContextMenu?.mode === 'assign-users' ? slotContextMenu.siteName : null;
  const slotContextAssignUsersColor = slotContextMenu?.mode === 'assign-users' ? slotContextMenu.color : null;

  const slotContextUserOptions = useMemo(() => {
    if (!slotContextAssignUsersDay || !slotContextAssignUsersSiteName || !slotContextAssignUsersColor) return [];

    return allUsers.map((candidate) => {
      const beforeCell = cloneApiCell(allGrid[candidate.id]?.[slotContextAssignUsersDay]);
      const entries = apiCellToSiteEntries(beforeCell);
      const hasSite = entries.some((entry) => entry.label === slotContextAssignUsersSiteName);
      const preview = previewCellAction({
        cell: beforeCell,
        action: 'add',
        siteName: slotContextAssignUsersSiteName,
        color: slotContextAssignUsersColor,
        familyKeyForSiteName: siteFamilyKeyForName,
        newEntryKind: 'site',
      });
      return {
        userId: candidate.id,
        userLabel: (candidate.name ?? candidate.email ?? candidate.id).trim(),
        hasSite,
        disabled: !hasSite && !preview.changed,
        disabledReason: typeof preview.reason === 'string' ? preview.reason : null,
      };
    });
  }, [
    allGrid,
    allUsers,
    siteFamilyKeyForName,
    slotContextAssignUsersColor,
    slotContextAssignUsersDay,
    slotContextAssignUsersSiteName,
  ]);

  const slotContextSelectedUserIds = useMemo(
    () =>
      new Set(slotContextMenu?.mode === 'assign-users' ? slotContextMenu.selectedUserIds : []),
    [slotContextMenu],
  );

  const slotContextSelectedSiblingNames = useMemo(
    () => normalizeOrderedNames(slotContextMenu?.mode === 'related-sites' ? slotContextMenu.selectedSiblingNames : []),
    [slotContextMenu],
  );

  const slotContextSelectedSiblingNameSet = useMemo(
    () => new Set(slotContextSelectedSiblingNames),
    [slotContextSelectedSiblingNames],
  );

  const slotContextSelectedSiblingOrder = useMemo(
    () => new Map(slotContextSelectedSiblingNames.map((name, index) => [name, index + 1] as const)),
    [slotContextSelectedSiblingNames],
  );

  const slotContextDefaultSiteColor = useMemo<LabelColor>(() => {
    if (!slotContextMenu || slotContextMenu.entryKind !== 'site') return 'default';
    const site = resolveStoredSite(slotContextMenu.siteName);
    return resolveSiteLabelColor(site, 'default');
  }, [resolveStoredSite, slotContextMenu]);

  const toggleSlotContextUser = useCallback((targetUserId: string) => {
    setSlotContextMenu((current) => {
      if (!current || current.mode !== 'assign-users') return current;
      const next = new Set(current.selectedUserIds);
      if (next.has(targetUserId)) next.delete(targetUserId);
      else next.add(targetUserId);
      return { ...current, selectedUserIds: Array.from(next) };
    });
  }, []);

  const slotContextRelatedSiteOptions = useMemo(() => {
    if (!slotContextMenu || slotContextMenu.entryKind !== 'site') return [];
    const anchorFamily = siteFamilyInfoForName(slotContextMenu.siteName);
    if (!anchorFamily.key || !anchorFamily.label) return [];

    const seen = new Set<string>();
    const selected = slotContextSelectedSiblingNameSet;
    const selectedCount = slotContextSelectedSiblingNames.length;

    return allSites
      .filter((site) => siteFamilyKeyForName(siteStoredName(site)) === anchorFamily.key)
      .map((site) => {
        const storedName = siteStoredName(site);
        if (!storedName || seen.has(storedName)) return null;
        seen.add(storedName);
        const checked = selected.has(storedName);
        const disabled = !checked && selectedCount >= MAX_GROUP_ITEMS;
        return {
          site,
          storedName,
          displayName: stripSiteFamilyLabel(storedName, anchorFamily.label) || storedName,
          checked,
          disabled,
        };
      })
      .filter((option): option is SlotContextRelatedSiteOption => !!option);
  }, [allSites, siteFamilyInfoForName, siteFamilyKeyForName, slotContextMenu, slotContextSelectedSiblingNameSet, slotContextSelectedSiblingNames.length]);

  const toggleSlotContextSibling = useCallback((storedName: string) => {
    setSlotContextMenu((current) => {
      if (!current || current.mode !== 'related-sites') return current;
      const next = normalizeOrderedNames(current.selectedSiblingNames);
      const existingIndex = next.indexOf(storedName);
      if (existingIndex >= 0) {
        next.splice(existingIndex, 1);
      } else {
        if (next.length >= MAX_GROUP_ITEMS) return current;
        next.push(storedName);
      }
      return { ...current, selectedSiblingNames: next };
    });
  }, []);

  const persistCellSet = useCallback(
    async (input: { targetUser: ApiUser; day: string; beforeCell: ApiCell; nextCell: ApiCell }) => {
      if (apiCellsEqual(input.beforeCell, input.nextCell)) {
        return { changed: false, failed: false as const };
      }

      onPreviewCellChange?.({ userId: input.targetUser.id, day: input.day, cell: input.nextCell });

      try {
        const r = await fetch('/api/schedule/cell/set', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            userId: input.targetUser.id,
            day: input.day,
            kind: apiKind,
            slot1: input.nextCell.slot1,
            slot2: input.nextCell.slot2,
            slot1Color: input.nextCell.color1,
            slot2Color: input.nextCell.color2,
            groups: apiCellToGroups(input.nextCell),
          }),
        });

        const json = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!r.ok || !json || json.ok !== true) {
          onPreviewCellChange?.({ userId: input.targetUser.id, day: input.day, cell: input.beforeCell });
          return {
            changed: false,
            failed: true as const,
            message: json?.error ?? `HTTP ${r.status}`,
          };
        }

        onCellHistory?.({
          kind: 'cell',
          userId: input.targetUser.id,
          day: input.day,
          before: cloneApiCell(input.beforeCell),
          after: cloneApiCell(input.nextCell),
          editorLabel: currentEditorLabel,
          at: Date.now(),
        });

        return { changed: true, failed: false as const };
      } catch {
        onPreviewCellChange?.({ userId: input.targetUser.id, day: input.day, cell: input.beforeCell });
        return { changed: false, failed: true as const, message: '通信に失敗しました' };
      }
    },
    [apiKind, currentEditorLabel, onCellHistory, onPreviewCellChange],
  );

  const applySelectedUsersToSite = useCallback(async () => {
    const current = slotContextMenu;
    if (!current || current.mode !== 'assign-users') return;

    const selected = new Set(current.selectedUserIds);
    const inheritedSyncSource = createScheduleSyncSource({
      parentUserId: user.id,
      parentDayYmd: current.day,
      familyKey: siteFamilyKeyForName(current.siteName),
    });
    let addedCount = 0;
    let removedCount = 0;
    let linkedCount = 0;
    let recoloredCount = 0;
    let skippedCapacityCount = 0;
    let failedCount = 0;

    for (const targetUser of allUsers) {
      const beforeCell = cloneApiCell(allGrid[targetUser.id]?.[current.day]);
      const beforeGroups = apiCellToGroups(beforeCell);
      const action = selected.has(targetUser.id) ? 'add' : 'remove';
      const exactGroupIndex = beforeGroups.findIndex((group) =>
        group.items.some((entry) => isSiteCellEntry(entry) && entry.label === current.siteName),
      );
      const legacyFamilyGroupIndex = inheritedSyncSource
        ? beforeGroups.findIndex((group) => {
            const hasFamilyMember = group.items.some(
              (entry) => isSiteCellEntry(entry) && siteFamilyKeyForName(entry.label) === inheritedSyncSource.familyKey,
            );
            const hasExistingSyncSource = group.items.some((entry) => Boolean(entry.syncSource));
            return hasFamilyMember && !hasExistingSyncSource;
          })
        : -1;
      const linkedGroupIndex = inheritedSyncSource
        ? beforeGroups.findIndex((group) =>
            group.items.some((entry) => scheduleSyncSourceEquals(entry.syncSource, inheritedSyncSource)),
          )
        : -1;

      if (action === 'add' && inheritedSyncSource && exactGroupIndex >= 0) {
        const nextCell = groupsToApiCell(
          beforeGroups.map((group, groupIndex) =>
            groupIndex !== exactGroupIndex
              ? group
              : {
                  ...group,
                  items: group.items.map((entry) =>
                    createCellEntry(entry.label, entry.color, {
                      kind: entry.kind,
                      syncSource: targetUser.id === user.id ? null : inheritedSyncSource,
                    }),
                  ),
                },
          ),
        );
        const result = await persistCellSet({
          targetUser,
          day: current.day,
          beforeCell,
          nextCell,
        });
        if (result.failed) {
          failedCount += 1;
          continue;
        }
        if (result.changed) {
          linkedCount += 1;
        }
        continue;
      }

      if (action === 'add' && inheritedSyncSource && targetUser.id !== user.id && exactGroupIndex < 0 && linkedGroupIndex < 0 && legacyFamilyGroupIndex >= 0) {
        const nextCell = groupsToApiCell(
          beforeGroups.map((group, groupIndex) =>
            groupIndex !== legacyFamilyGroupIndex
              ? group
              : {
                  ...group,
                  items: group.items.map((entry) =>
                    createCellEntry(entry.label, entry.color, {
                      kind: entry.kind,
                      syncSource: inheritedSyncSource,
                    }),
                  ),
                },
          ),
        );
        const result = await persistCellSet({
          targetUser,
          day: current.day,
          beforeCell,
          nextCell,
        });
        if (result.failed) {
          failedCount += 1;
          continue;
        }
        if (result.changed) {
          linkedCount += 1;
        }
        continue;
      }

      if (action === 'remove' && linkedGroupIndex >= 0) {
        const nextCell = groupsToApiCell(
          beforeGroups.filter((_, groupIndex) => groupIndex !== linkedGroupIndex),
        );
        const result = await persistCellSet({
          targetUser,
          day: current.day,
          beforeCell,
          nextCell,
        });
        if (result.failed) {
          failedCount += 1;
          continue;
        }
        if (result.changed) {
          removedCount += 1;
        }
        continue;
      }

      const preview = previewCellAction({
        cell: beforeCell,
        action,
        siteName: current.siteName,
        color: current.color,
        familyKeyForSiteName: siteFamilyKeyForName,
        newEntryKind: 'site',
        newEntrySyncSource: action === 'add' && targetUser.id !== user.id ? inheritedSyncSource : null,
      });
      if (!preview.changed) {
        if (preview.reason === 'cell-full' || preview.reason === 'group-full') skippedCapacityCount += 1;
        continue;
      }

      const result = await persistCellSet({
        targetUser,
        day: current.day,
        beforeCell,
        nextCell: preview.cell,
      });
      if (result.failed) {
        failedCount += 1;
        continue;
      }

      if (action === 'add') {
        const hadSite = apiCellToSiteEntries(beforeCell).some((entry) => entry.label === current.siteName);
        if (hadSite) recoloredCount += 1;
        else addedCount += 1;
      }
      if (action === 'remove') removedCount += 1;
    }

    closeSlotContextMenu();

    if (addedCount || removedCount || recoloredCount) {
      void Promise.resolve(onAssigned()).catch(() => undefined);
    }

    const messages: string[] = [];
    if (addedCount) messages.push(`${addedCount}名追加`);
    if (removedCount) messages.push(`${removedCount}名削除`);
    if (linkedCount) messages.push(`${linkedCount}名リンク`);
    if (recoloredCount) messages.push(`${recoloredCount}名色同期`);
    if (skippedCapacityCount) messages.push(`${skippedCapacityCount}名は枠上限`);
    if (failedCount) messages.push(`${failedCount}名失敗`);
    onNotify?.(messages.length > 0 ? `同日・同現場を更新: ${messages.join(' / ')}` : '変更はありません');
  }, [allGrid, allUsers, closeSlotContextMenu, onAssigned, onNotify, persistCellSet, siteFamilyKeyForName, slotContextMenu, user.id]);

  const applySelectedSiblingSites = useCallback(async () => {
    const current = slotContextMenu;
    if (!current || current.mode !== 'related-sites') return;

    const anchorFamilyKey = siteFamilyKeyForName(current.siteName);
    if (!anchorFamilyKey) {
      onNotify?.('同名別店舗を判定できませんでした');
      return;
    }

    const selectedNames = normalizeOrderedNames(current.selectedSiblingNames);
    if (selectedNames.length === 0) {
      onNotify?.('少なくとも1店舗は選択してください');
      return;
    }

    const selectedSiteMap = new Map(slotContextRelatedSiteOptions.map((option) => [option.storedName, option] as const));
    const selectedSites = selectedNames
      .map((storedName) => selectedSiteMap.get(storedName))
      .filter((option): option is SlotContextRelatedSiteOption => Boolean(option));
    if (selectedSites.length > MAX_GROUP_ITEMS) {
      onNotify?.('同名別店舗は4件までです');
      return;
    }

    const ownerSyncSource = createScheduleSyncSource({
      parentUserId: user.id,
      parentDayYmd: current.day,
      familyKey: anchorFamilyKey,
    });
    const currentGroup = apiCellToGroups(current.beforeCell).find((group) =>
      group.items.some((entry) => isSiteCellEntry(entry) && entry.label === current.siteName),
    );
    const currentGroupSyncSource =
      currentGroup?.items.find((entry) => isSiteCellEntry(entry) && entry.label === current.siteName)?.syncSource ?? currentGroup?.items[0]?.syncSource ?? null;
    const isParentEdit = !currentGroupSyncSource || scheduleSyncSourceEquals(currentGroupSyncSource, ownerSyncSource);

    const targetUsers = isParentEdit && ownerSyncSource
      ? allUsers.filter((candidate) =>
          candidate.id === user.id ||
          apiCellToGroups(allGrid[candidate.id]?.[current.day]).some((group) =>
            group.items.some((entry) => scheduleSyncSourceEquals(entry.syncSource, ownerSyncSource)),
          ),
        )
      : [user];

    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const targetUser of targetUsers) {
      const beforeCell = cloneApiCell(allGrid[targetUser.id]?.[current.day]);
      const currentEntries = apiCellToSiteEntries(beforeCell);
      const currentGroups = apiCellToGroups(beforeCell);
      const targetGroupIndex = targetUser.id === user.id
        ? currentGroups.findIndex((group) => group.items.some((entry) => isSiteCellEntry(entry) && entry.label === current.siteName))
        : currentGroups.findIndex((group) =>
            group.items.some((entry) => scheduleSyncSourceEquals(entry.syncSource, ownerSyncSource)),
          );

      if (targetGroupIndex < 0) {
        skippedCount += 1;
        continue;
      }

      const currentColorByName = new Map(currentEntries.map((entry) => [entry.label, entry.color] as const));
      const anchorColor = currentColorByName.get(current.siteName) ?? current.color;
      const nextSyncSource = targetUser.id === user.id || !isParentEdit ? null : ownerSyncSource;
      const replacementGroup: ApiCellGroup = {
        note: currentGroups[targetGroupIndex]?.note ?? null,
        items: selectedSites.map((option) =>
          createCellEntry(
            option.storedName,
            currentColorByName.get(option.storedName) ?? resolveSiteLabelColor(option.site, anchorColor),
            { kind: 'site', syncSource: nextSyncSource },
          ),
        ),
      };

      const nextGroups = currentGroups.map((group) => ({ items: [...group.items] }));
      nextGroups[targetGroupIndex] = replacementGroup;

      if (nextGroups.length > MAX_CELL_GROUPS) {
        skippedCount += 1;
        continue;
      }

      const result = await persistCellSet({
        targetUser,
        day: current.day,
        beforeCell,
        nextCell: groupsToApiCell(nextGroups),
      });
      if (result.failed) {
        failedCount += 1;
        continue;
      }
      if (result.changed) {
        updatedCount += 1;
      }
    }

    closeSlotContextMenu();

    if (updatedCount > 0) {
      void Promise.resolve(onAssigned()).catch(() => undefined);
    }

    const messages: string[] = [];
    if (updatedCount) messages.push(`${updatedCount}名反映`);
    if (skippedCount) messages.push(`${skippedCount}名スキップ`);
    if (failedCount) messages.push(`${failedCount}名失敗`);
    onNotify?.(messages.length > 0 ? `同名別店舗を同期: ${messages.join(' / ')}` : '変更はありません');
  }, [allGrid, allUsers, closeSlotContextMenu, onAssigned, onNotify, persistCellSet, siteFamilyKeyForName, slotContextMenu, slotContextRelatedSiteOptions, user]);

  async function applySlotContextGroupColor(nextColor: LabelColor) {
    const current = slotContextMenu;
    if (!current || (current.mode !== 'actions' && current.mode !== 'change-color')) return;

    const beforeCell = cloneApiCell(current.beforeCell);
    const beforeGroups = apiCellToGroups(beforeCell);
    const targetGroup = beforeGroups[current.groupIndex];
    if (!targetGroup) {
      closeSlotContextMenu();
      onNotify?.('対象の枠が見つかりません');
      return;
    }

    const result = await persistCellSet({
      targetUser: user,
      day: current.day,
      beforeCell,
      nextCell: groupsToApiCell(
        beforeGroups.map((group, groupIndex) =>
          groupIndex !== current.groupIndex
            ? group
            : {
                ...group,
                items: group.items.map((entry) =>
                  createCellEntry(entry.label, nextColor, { kind: entry.kind, syncSource: entry.syncSource }),
                ),
              },
        ),
      ),
    });
    if (result.failed) {
      onNotify?.(result.message ? `操作に失敗しました: ${result.message}` : '通信に失敗しました');
      return;
    }
    if (!result.changed) {
      onNotify?.('変更はありません');
      return;
    }

    let syncedCount = 0;
    let failedCount = 0;
    if (current.entryKind === 'site') {
      for (const entry of targetGroup.items.filter((item) => isSiteCellEntry(item))) {
        const syncResult = await syncSiteColorAcrossUsers({
          day: current.day,
          siteName: entry.label,
          color: nextColor,
          sourceUserId: user.id,
        });
        syncedCount += syncResult.syncedCount;
        failedCount += syncResult.failedCount;
      }
    }

    closeSlotContextMenu();
    const messages = ['色を変更しました'];
    if (syncedCount > 0) messages.push(`他${syncedCount}名に色同期`);
    if (failedCount > 0) messages.push(`${failedCount}名失敗`);
    onNotify?.(messages.join(' / '));
    void Promise.resolve(onAssigned()).catch(() => undefined);
  }

  async function applySlotContextSiteDefaultColor(nextColor: LabelColor) {
    const current = slotContextMenu;
    if (!current || current.entryKind !== 'site' || (current.mode !== 'actions' && current.mode !== 'change-color')) return;

    const site = resolveStoredSite(current.siteName);
    if (!site?.id) {
      onNotify?.('現場マスタが見つかりません');
      return;
    }

    try {
      const response = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: site.id,
          scheduleLabelColor: nextColor,
        }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !json?.ok) {
        onNotify?.(json?.error ? `デフォルト色の保存に失敗しました: ${json.error}` : 'デフォルト色の保存に失敗しました');
        return;
      }
      closeSlotContextMenu();
      onNotify?.('デフォルト色を保存しました');
      void Promise.resolve(onAssigned()).catch(() => undefined);
    } catch {
      onNotify?.('デフォルト色の保存に失敗しました');
    }
  }

  async function removeSlotContextGroup() {
    const current = slotContextMenu;
    if (!current || current.mode !== 'actions') return;

    const beforeCell = cloneApiCell(current.beforeCell);
    const beforeGroups = apiCellToGroups(beforeCell);
    if (!beforeGroups[current.groupIndex]) {
      closeSlotContextMenu();
      onNotify?.('対象の枠が見つかりません');
      return;
    }

    const result = await persistCellSet({
      targetUser: user,
      day: current.day,
      beforeCell,
      nextCell: groupsToApiCell(beforeGroups.filter((_, groupIndex) => groupIndex !== current.groupIndex)),
    });
    if (result.failed) {
      onNotify?.(result.message ? `操作に失敗しました: ${result.message}` : '通信に失敗しました');
      return;
    }
    if (!result.changed) {
      onNotify?.('変更はありません');
      return;
    }

    closeSlotContextMenu();
    onNotify?.('削除しました');
    void Promise.resolve(onAssigned()).catch(() => undefined);
  }

  async function applySlotContextNote() {
    const current = slotContextMenu;
    if (!current || current.mode !== 'append-note') return;

    const noteText = current.noteDraft.trim();
    if (!noteText) {
      onNotify?.(current.entryKind === 'site' ? '追加記入を入力してください' : '追記を入力してください');
      return;
    }

    const beforeCell = cloneApiCell(current.beforeCell);
    const beforeGroups = apiCellToGroups(beforeCell);
    const targetGroup = beforeGroups[current.groupIndex];
    if (!targetGroup) {
      closeSlotContextMenu();
      onNotify?.('対象の枠が見つかりません');
      return;
    }

    const hasSiteEntry = targetGroup.items.some((entry) => isSiteCellEntry(entry));
    const hasNoteEntry = targetGroup.items.some((entry) => normalizeScheduleCellEntryKind(entry.kind) === 'note');
    if (!hasSiteEntry && !hasNoteEntry) {
      closeSlotContextMenu();
      onNotify?.('対象の枠が見つかりません');
      return;
    }

    const result = await persistCellSet({
      targetUser: user,
      day: current.day,
      beforeCell,
      nextCell: groupsToApiCell(
        beforeGroups.map((group, groupIndex) =>
          groupIndex !== current.groupIndex
            ? group
            : hasSiteEntry
              ? { ...group, note: noteText }
              : {
                  ...group,
                  items: [
                    createCellEntry(noteText, group.items[0]?.color ?? 'default', {
                      kind: 'note',
                      syncSource: group.items[0]?.syncSource ?? null,
                    }),
                  ],
                },
        ),
      ),
    });
    if (result.failed) {
      onNotify?.(result.message ? `操作に失敗しました: ${result.message}` : '通信に失敗しました');
      return;
    }
    if (!result.changed) {
      onNotify?.('変更はありません');
      return;
    }

    closeSlotContextMenu();
    onNotify?.(hasSiteEntry ? '追加記入を更新しました' : '追記を更新しました');
    void Promise.resolve(onAssigned()).catch(() => undefined);
  }

  const getNoteGroupEditorDraft = useCallback((cell: ApiCell, groupIndex: number) => {
    const targetGroup = apiCellToGroups(cell)[groupIndex];
    if (!targetGroup) return '';
    const noteLabels = targetGroup.items
      .filter((entry) => normalizeScheduleCellEntryKind(entry.kind) === 'note')
      .map((entry) => entry.label.trim())
      .filter(Boolean);
    return noteLabels.join(' / ') || targetGroup.note || '';
  }, []);

  const openInlineEditor = useCallback(
    (input: { day: string; cell: ApiCell; preferredGroupIndex?: number; source?: WeekHubEditSource }) => {
      const groups = apiCellToGroups(input.cell);
      const firstSiteGroupIndex = groups.findIndex((group) =>
        group.items.some((entry) => isSiteCellEntry(entry)),
      );
      const rawGroupIndex =
        typeof input.preferredGroupIndex === 'number'
          ? Math.max(0, Math.trunc(input.preferredGroupIndex))
          : firstSiteGroupIndex >= 0
            ? firstSiteGroupIndex
            : groups.length;
      const groupIndex = Math.min(rawGroupIndex, groups.length);
      const targetGroup = groups[groupIndex];
      const initialTargetItemIndex = targetGroup
        ? targetGroup.items.findIndex((entry) => isSiteCellEntry(entry))
        : -1;
      const normalizedTargetItemIndex = initialTargetItemIndex >= 0 ? initialTargetItemIndex : null;
      const initialValue =
        normalizedTargetItemIndex !== null && targetGroup
          ? targetGroup.items[normalizedTargetItemIndex]?.label ?? ''
          : '';
      setEditingCell?.({
        userId: user.id,
        day: input.day,
        slotIndex: groupIndex,
        source: input.source ?? 'direct',
        targetItemIndex: normalizedTargetItemIndex,
      });
      setEditingInput?.(initialValue);
      setSiteSuggestions?.([]);
    },
    [setEditingCell, setEditingInput, setSiteSuggestions, user.id],
  );

  const commitInlineEdit = useCallback(
    async (input: { day: string; beforeCell: ApiCell; slotIndex: number; targetItemIndex?: number | null; siteId?: string | null; siteName?: string | null }) => {
      const rawSiteName = input.siteName?.trim() ?? '';
      const resolvedSite =
        resolveSiteReference?.({ siteId: input.siteId ?? null, siteName: rawSiteName || null }) ??
        resolveStoredSite(rawSiteName);
      const nextSiteName =
        siteStoredName(resolvedSite) || splitSiteLabel(rawSiteName).name.trim() || rawSiteName;
      if (!nextSiteName) {
        onNotify?.('現場名を入力してください');
        return;
      }

      const beforeCell = cloneApiCell(input.beforeCell);
      const beforeGroups = apiCellToGroups(beforeCell);
      const targetGroupIndex = Math.max(0, Math.min(input.slotIndex, beforeGroups.length));
      const targetGroup = beforeGroups[targetGroupIndex] ?? null;
      const targetItemIndex =
        targetGroup &&
        typeof input.targetItemIndex === 'number' &&
        input.targetItemIndex >= 0 &&
        input.targetItemIndex < targetGroup.items.length &&
        isSiteCellEntry(targetGroup.items[input.targetItemIndex])
          ? input.targetItemIndex
          : targetGroup?.items.findIndex((entry) => isSiteCellEntry(entry)) ?? -1;
      const hasDuplicateSite = beforeGroups.some((group, groupIndex) =>
        group.items.some(
          (entry, itemIndex) =>
            isSiteCellEntry(entry) &&
            entry.label === nextSiteName &&
            !(groupIndex === targetGroupIndex && itemIndex === targetItemIndex),
        ),
      );
      if (hasDuplicateSite) {
        onNotify?.('すでに登録済みです');
        return;
      }

      const nextGroups = (() => {
        if (targetGroupIndex < beforeGroups.length) {
          if (!targetGroup) return beforeGroups;
          if (targetItemIndex >= 0) {
            return beforeGroups.map((group, groupIndex) =>
              groupIndex !== targetGroupIndex
                ? group
                : {
                    ...group,
                    items: group.items.map((entry, itemIndex) =>
                      itemIndex !== targetItemIndex
                        ? entry
                        : createCellEntry(
                            nextSiteName,
                            resolveSiteLabelColor(resolvedSite, entry.color ?? cellTextColor),
                            { kind: 'site' },
                          ),
                    ),
                  },
            );
          }
          const nextGroup: ApiCellGroup = {
            items: [createCellEntry(nextSiteName, resolveSiteLabelColor(resolvedSite, cellTextColor), { kind: 'site' })],
            note: targetGroup.note ?? null,
          };
          return beforeGroups.map((group, groupIndex) => (groupIndex === targetGroupIndex ? nextGroup : group));
        }
        if (beforeGroups.length >= MAX_CELL_GROUPS) return null;
        return [
          ...beforeGroups,
          {
            items: [createCellEntry(nextSiteName, resolveSiteLabelColor(resolvedSite, cellTextColor), { kind: 'site' })],
            note: null,
          },
        ];
      })();

      if (!nextGroups) {
        onNotify?.('満杯のため追加できません（4枠あり）');
        return;
      }

      const result = await persistCellSet({
        targetUser: user,
        day: input.day,
        beforeCell,
        nextCell: groupsToApiCell(nextGroups),
      });
      if (result.failed) {
        onNotify?.(result.message ? `操作に失敗しました: ${result.message}` : '通信に失敗しました');
        return;
      }
      if (!result.changed) {
        onNotify?.('変更はありません');
        return;
      }

      onNotify?.(targetGroupIndex < beforeGroups.length ? '編集しました' : '追加しました');
      void Promise.resolve(onAssigned()).catch(() => undefined);
    },
    [cellTextColor, onAssigned, onNotify, persistCellSet, resolveSiteReference, resolveStoredSite, user],
  );

  const renderSiteLabel = useCallback(
    (
      input: {
        displayValue: ReactNode;
        displayText: string;
        tooltipValue: string;
        siteName: string | null;
        entryKind: ScheduleCellEntryKind;
        className: string;
        fontSize: string;
        dragState?: DraggedCellState | null;
        hoverMenuItems?: CellHoverMenuItem[];
        contextInput?: { userId: string; day: string; beforeCell: ApiCell; color: LabelColor; groupIndex: number; groupNote?: string | null };
      },
    ) => {
      const contextInput = input.contextInput;
      const dragState = input.dragState;
      const handleContextMenu = contextInput
        ? (event: ReactMouseEvent<HTMLElement>) => {
            openSlotContextMenu(event, {
              day: contextInput.day,
              siteName: input.siteName ?? input.displayText,
              color: contextInput.color,
              beforeCell: contextInput.beforeCell,
              groupIndex: contextInput.groupIndex,
              entryKind: input.entryKind,
              groupNote: contextInput.groupNote,
            });
          }
        : undefined;
      const handleDragStart = dragState
        ? (event: React.DragEvent<HTMLElement>) => {
            event.stopPropagation();
            onSetDraggedCell?.(dragState);
            event.dataTransfer.effectAllowed = 'copy';
          }
        : undefined;
      const handleDragEnd = dragState
        ? (event: React.DragEvent<HTMLElement>) => {
            event.stopPropagation();
            onSetDraggedCell?.(null);
          }
        : undefined;
      const handleInlineEdit =
        contextInput && input.entryKind === 'site'
          ? (event: ReactMouseEvent<HTMLElement>) => {
              if (!isEditable) return;
              event.preventDefault();
              event.stopPropagation();
              openInlineEditor({
                day: contextInput.day,
                cell: contextInput.beforeCell,
                preferredGroupIndex: contextInput.groupIndex,
              });
            }
          : undefined;
      const hoverMenuItems = input.hoverMenuItems ?? [];
      const hasHoverMenu = hoverMenuItems.length > 0;
      const hoverMenu = hasHoverMenu ? (
        <div
          className="pointer-events-none invisible absolute left-0 top-full z-[80] min-w-[220px] max-w-[320px] overflow-hidden rounded-md border border-zinc-300 bg-white opacity-0 shadow-lg transition group-hover/slot:visible group-hover/slot:pointer-events-auto group-hover/slot:opacity-100 group-focus-within/slot:visible group-focus-within/slot:pointer-events-auto group-focus-within/slot:opacity-100 dark:border-zinc-700 dark:bg-zinc-950"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="max-h-56 overflow-auto py-1">
            {hoverMenuItems.map((item) =>
              item.kind === 'site' && item.siteName ? (
                <button
                  key={item.key}
                  type="button"
                  className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900 ${item.className ?? 'text-zinc-900 dark:text-zinc-100'}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenSiteFromCell?.(
                      item.siteName ?? '',
                      contextInput
                        ? {
                            userId: contextInput.userId,
                            day: contextInput.day,
                            slotIndex: contextInput.groupIndex,
                            source: 'direct',
                            targetItemIndex: null,
                          }
                        : undefined,
                    );
                  }}
                >
                  {item.label}
                </button>
              ) : (
                <div key={item.key} className="px-3 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200">
                  <span className="text-red-600 dark:text-red-400">追記:</span>
                  {' '}
                  <span>{item.label}</span>
                </div>
              ),
            )}
          </div>
        </div>
      ) : null;
      if (input.entryKind !== 'site' || !input.siteName || !onOpenSiteFromCell) {
        return (
          <div className="group/slot relative">
            <div
              data-color-edit-ignore-contextmenu
              className={input.className}
              style={{ fontSize: input.fontSize }}
              draggable={Boolean(dragState)}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onContextMenu={handleContextMenu}
              title={hasHoverMenu ? undefined : input.tooltipValue}
            >
              {input.displayValue}
            </div>
            {hoverMenu}
          </div>
        );
      }
      const siteName = input.siteName;
      return (
        <div className="group/slot relative">
          <div
            role="button"
            tabIndex={0}
            data-color-edit-ignore-contextmenu
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenSiteFromCell(
                siteName,
                contextInput
                  ? {
                      userId: contextInput.userId,
                      day: contextInput.day,
                      slotIndex: contextInput.groupIndex,
                      source: 'direct',
                      targetItemIndex: null,
                    }
                  : undefined,
              );
            }}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onOpenSiteFromCell(
                siteName,
                contextInput
                  ? {
                      userId: contextInput.userId,
                      day: contextInput.day,
                      slotIndex: contextInput.groupIndex,
                      source: 'direct',
                      targetItemIndex: null,
                    }
                  : undefined,
              );
            }}
            onContextMenu={handleContextMenu}
            draggable={Boolean(dragState)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDoubleClick={handleInlineEdit}
            className={`${input.className} w-full cursor-pointer text-left hover:underline`}
            style={{ fontSize: input.fontSize }}
            title={hasHoverMenu ? undefined : input.tooltipValue}
            aria-label={`${siteName} の詳細を開く`}
          >
            {input.displayValue}
          </div>
          {hoverMenu}
        </div>
      );
    },
    [isEditable, onOpenSiteFromCell, onSetDraggedCell, openInlineEditor, openSlotContextMenu],
  );

  const renderCellLabels = useCallback(
    (cell: ApiCell | null | undefined, day: string, beforeCell: ApiCell) => {
      const groups = apiCellToGroups(cell);
      if (groups.length === 0) return null;

      return groups.map((group, groupIndex) => {
        const anchorEntry = group.items.find((entry) => isSiteCellEntry(entry)) ?? group.items[0] ?? null;
        const familyLabel = anchorEntry && isSiteCellEntry(anchorEntry) ? siteFamilyLabelForName(anchorEntry.label) : null;
        const renderedItems = group.items.map((entry, itemIndex) => {
          if (!isSiteCellEntry(entry)) {
            return {
              entry,
              storedName: entry.label,
              displayName: `追記: ${entry.label}`,
              fullDisplayName: entry.label,
            };
          }
          const site = resolveStoredSite(entry.label);
          const fullName = siteFamilyDisplayName(siteStoredName(site) || entry.label);
          return {
            entry,
            storedName: entry.label,
            fullDisplayName: fullName,
            displayName:
              familyLabel && itemIndex > 0
                ? stripSiteFamilyLabel(fullName, familyLabel) || fullName
                : fullName,
          };
        });
        const groupNote = normalizeScheduleCellNote(group.note);
        const tooltipValue = [
          ...renderedItems.map((item) => item.displayName),
          ...(groupNote ? [`追記: ${groupNote}`] : []),
        ].join('\n');
        const displayText =
          formatScheduleCellGroupDisplayValue(
            renderedItems.map((item) => item.displayName),
            groupNote,
          ) ?? '';
        const siteItems = renderedItems.filter((item) => isSiteCellEntry(item.entry));
        const noteItems = renderedItems.filter((item) => !isSiteCellEntry(item.entry));
        const isNoteGroup = renderedItems.every((item) => !isSiteCellEntry(item.entry));
        const hasMultipleSitesInGroup = siteItems.length > 1;
        const hoverMenuItems: CellHoverMenuItem[] =
          siteItems.length > 1 || noteItems.length > 0 || Boolean(groupNote)
            ? [
                ...siteItems.map((item, itemIndex) => ({
                  key: `hover-site:${day}:${groupIndex}:${itemIndex}`,
                  kind: 'site' as const,
                  label: item.fullDisplayName,
                  siteName: item.storedName,
                  className: labelTextClass(item.entry.color ?? 'default', 'primary'),
                })),
                ...noteItems.map((item, itemIndex) => ({
                  key: `hover-note:${day}:${groupIndex}:${itemIndex}`,
                  kind: 'note' as const,
                  label: item.fullDisplayName,
                })),
                ...(groupNote
                  ? [
                      {
                        key: `hover-group-note:${day}:${groupIndex}`,
                        kind: 'note' as const,
                        label: groupNote,
                      },
                    ]
                  : []),
              ]
            : [];
        const displayValue = (
          <>
            {renderedItems.map((item, itemIndex) => {
              const isSiteItem = isSiteCellEntry(item.entry);
              return (
                <Fragment key={`display:${day}:${groupIndex}:${itemIndex}`}>
                  {itemIndex > 0 ? <span className="text-zinc-400 dark:text-zinc-500"> / </span> : null}
                  {isSiteItem ? (
                    <span className={labelTextClass(item.entry.color ?? 'default', itemIndex === 0 ? 'primary' : 'secondary')}>
                      {item.displayName}
                    </span>
                  ) : (
                    <>
                      <span className="text-red-600 dark:text-red-400">追記:</span>
                      {' '}
                      <span className="text-zinc-700 dark:text-zinc-200">{item.fullDisplayName}</span>
                    </>
                  )}
                </Fragment>
              );
            })}
            {groupNote ? (
              <>
                {renderedItems.length > 0 ? <span className="text-zinc-400 dark:text-zinc-500">（</span> : null}
                <span className="text-red-600 dark:text-red-400">追記:</span>
                {' '}
                <span className="text-zinc-700 dark:text-zinc-200">{groupNote}</span>
                {renderedItems.length > 0 ? <span className="text-zinc-400 dark:text-zinc-500">）</span> : null}
              </>
            ) : null}
            {hasMultipleSitesInGroup ? (
              <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-xs font-bold leading-none text-red-600 dark:text-red-400">
                +
              </span>
            ) : null}
          </>
        );
        const dragState = isEditable && anchorEntry && isSiteCellEntry(anchorEntry)
          ? { userId: user.id, day, cell: groupsToApiCell([group]) }
          : null;
        return (
          <div key={`group:${day}:${groupIndex}`} className={`relative ${groupIndex > 0 ? 'mt-1' : ''}`}>
            {renderSiteLabel({
              displayValue,
              displayText,
              tooltipValue,
              siteName: anchorEntry && isSiteCellEntry(anchorEntry) ? anchorEntry.label : null,
              entryKind: anchorEntry ? normalizeScheduleCellEntryKind(anchorEntry.kind) : 'site',
              className: `block overflow-hidden text-ellipsis whitespace-nowrap rounded-md border px-1.5 py-1 text-zinc-800 dark:text-zinc-200 ${gridLayout === 'comfortable' ? 'leading-snug' : 'leading-tight'} ${
                hasMultipleSitesInGroup ? 'relative pr-4' : ''
              } ${
                isNoteGroup
                  ? 'border-amber-200/80 bg-amber-50/70 italic dark:border-amber-900/60 dark:bg-amber-950/20'
                  : 'border-zinc-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/40'
              }`,
              fontSize: groupIndex === 0 ? 'var(--weekhub-cell-font-size, 12px)' : 'calc(var(--weekhub-cell-font-size, 12px) * 0.95)',
              hoverMenuItems,
              dragState,
              contextInput: { userId: user.id, day, beforeCell, color: anchorEntry?.color ?? 'default', groupIndex, groupNote },
            })}
          </div>
        );
      });
    },
    [gridLayout, isEditable, renderSiteLabel, resolveStoredSite, siteFamilyLabelForName, user.id],
  );

  const formatCellActionReason = useCallback((
    reason: unknown,
    action: CellClickAction,
  ): string | null => {
    if (typeof reason !== 'string') return null;
    if (reason === 'group-full') return '同名別店舗は1枠4件までです';
    if (reason === 'cell-full') {
      return action === 'add'
        ? '満杯のため追加できません（4枠あり）'
        : action === 'toggle'
          ? '満杯のため追加できません（4枠あり）'
          : '満杯のため反映できません（4枠あり）';
    }
    if (reason === 'already-exists') {
      return action === 'remove' ? '削除対象がありません（未登録）' : 'すでに登録済みです';
    }
    if (reason === 'not-found') return '削除対象がありません（未登録）';
    if (reason === 'not-enough-entries') return '入替できません（2枠揃っていません）';
    return `反映できません（reason=${reason}）`;
  }, []);

  const formatCellActionSuccess = useCallback((input: {
    action: CellClickAction;
    toggled?: unknown;
    replaced?: unknown;
  }): string => {
    if (input.action === 'swap') return '入替しました';
    if (input.action === 'recolor') return '色を変更しました';
    if (input.replaced === 'last-slot') return '末尾枠を置換しました';
    if (input.action === 'remove') return '削除しました';
    if (input.action === 'add') return '追加しました';
    if (input.action === 'replace2') return '末尾枠を置換しました';
    if (input.action === 'toggle') {
      return input.toggled === 'off' ? '削除しました' : '追加しました';
    }
    return '反映しました';
  }, []);

  const syncSiteColorAcrossUsers = useCallback(
    async (input: { day: string; siteName: string; color: LabelColor; sourceUserId: string }) => {
      const buildTargets = (gridSnapshot: Record<string, Record<string, ApiCell>> | null | undefined) =>
        allUsers
          .filter((targetUser) => targetUser.id !== input.sourceUserId)
          .map((targetUser) => {
            const beforeCell = cloneApiCell(gridSnapshot?.[targetUser.id]?.[input.day]);
            const preview = previewCellAction({
              cell: beforeCell,
              action: 'recolor',
              siteName: input.siteName,
              color: input.color,
              familyKeyForSiteName: siteFamilyKeyForName,
            });

            if (!preview.changed) return null;

            return {
              targetUser,
              beforeCell,
              nextCell: preview.cell,
            };
          })
          .filter(
            (
              target,
            ): target is { targetUser: ApiUser; beforeCell: ApiCell; nextCell: ApiCell } => target !== null,
          );

      let targets = buildTargets(allGrid);
      const localCandidateIds = assignedUserIdsForSite(input.day, input.siteName).filter(
        (userId) => userId !== input.sourceUserId,
      );

      if (targets.length === 0 && localCandidateIds.length > 0) {
        try {
          const weekStart = toYmd(startOfWeekMonday(new Date(`${input.day}T00:00:00`)));
          const kind = apiKind === 'DAILY' ? 'daily' : 'normal';
          const response = await fetch(
            `/api/schedule/week?weekStart=${encodeURIComponent(weekStart)}&kind=${encodeURIComponent(kind)}`,
            { cache: 'no-store' },
          );
          const latest = (await response.json().catch(() => null)) as ApiResponse | null;
          if (response.ok && latest?.grid) {
            targets = buildTargets(latest.grid);
          }
        } catch {
          // Keep the optimistic local result when the fallback refresh is unavailable.
        }
      }

      if (targets.length === 0) return { syncedCount: 0, failedCount: 0 };

      const results = await Promise.all(
        targets.map((target) =>
          persistCellSet({
            targetUser: target.targetUser,
            day: input.day,
            beforeCell: target.beforeCell,
            nextCell: target.nextCell,
          }),
        ),
      );

      let syncedCount = 0;
      let failedCount = 0;
      for (const result of results) {
        if (result.failed) failedCount += 1;
        else if (result.changed) syncedCount += 1;
      }

      return { syncedCount, failedCount };
    },
    [allGrid, allUsers, apiKind, assignedUserIdsForSite, persistCellSet, siteFamilyKeyForName],
  );

  const runCellAction = useCallback(
    async (input: {
      day: string;
      action: CellClickAction;
      color: CellTextColor;
      siteId?: string | null;
      siteName?: string | null;
      beforeCell: ApiCell;
      allowSiblingMerge?: boolean;
    }) => {
      let resolvedSite =
        input.action === 'swap'
          ? selectedSite
          : resolveSiteReference?.({ siteId: input.siteId ?? null, siteName: input.siteName ?? null }) ??
            (!input.siteId && !input.siteName ? selectedSite : null);

      if (input.action !== 'swap' && !input.siteId && !input.siteName && !resolvedSite) {
        resolvedSite = (await onEnsureSite?.()) ?? null;
        if (!resolvedSite) {
          onNotify?.('現場名を入力してください');
          return;
        }
      }

      const beforeCell = cloneApiCell(input.beforeCell);
      const resolvedSiteName =
        siteStoredName(resolvedSite) || splitSiteLabel(input.siteName).name.trim() || input.siteName?.trim() || null;
      const requestedColor = input.action === 'recolor' ? input.color : resolveSiteLabelColor(resolvedSite, input.color);
      const preview = previewCellAction({
        cell: beforeCell,
        action: input.action,
        siteName: resolvedSiteName,
        color: requestedColor,
        familyKeyForSiteName: siteFamilyKeyForName,
        allowSiblingMerge: input.allowSiblingMerge,
      });

      if (!preview.changed) {
        onNotify?.(formatCellActionReason(preview.reason, input.action) ?? '反映されませんでした');
        return;
      }

      const result = await persistCellSet({
        targetUser: user,
        day: input.day,
        beforeCell,
        nextCell: preview.cell,
      });
      if (result.failed) {
        onNotify?.(result.message ? `操作に失敗しました: ${result.message}` : '通信に失敗しました');
        return;
      }
      if (!result.changed) {
        onNotify?.('変更はありません');
        return;
      }

      let syncedCount = 0;
      let failedCount = 0;
      if (input.action === 'recolor' && resolvedSiteName) {
        const syncResult = await syncSiteColorAcrossUsers({
          day: input.day,
          siteName: resolvedSiteName,
          color: requestedColor,
          sourceUserId: user.id,
        });
        syncedCount = syncResult.syncedCount;
        failedCount = syncResult.failedCount;
      }

      const successMessage = formatCellActionSuccess({
        action: input.action,
        toggled: preview.toggled,
        replaced: preview.replaced,
      });

      const messages = [successMessage];
      if (syncedCount > 0) messages.push(`他${syncedCount}名に色同期`);
      if (failedCount > 0) messages.push(`${failedCount}名失敗`);
      onNotify?.(messages.join(' / '));

      void Promise.resolve(onAssigned()).catch(() => undefined);
    },
    [
      formatCellActionReason,
      formatCellActionSuccess,
      onAssigned,
      onEnsureSite,
      onNotify,
      persistCellSet,
      resolveSiteReference,
      selectedSite,
      siteFamilyKeyForName,
      syncSiteColorAcrossUsers,
      user,
    ],
  );

  const applyDraggedGroup = useCallback(
    async (input: { day: string; beforeCell: ApiCell; dragged: DraggedCellState }) => {
      const beforeCell = cloneApiCell(input.beforeCell);
      const beforeGroups = apiCellToGroups(beforeCell);
      const draggedGroup = cloneCellGroups(apiCellToGroups(input.dragged.cell))[0];
      if (!draggedGroup) {
        onNotify?.('ドラッグ元の枠が見つかりません');
        return;
      }

      const draggedSiteNames = new Set(
        draggedGroup.items.filter((entry) => isSiteCellEntry(entry)).map((entry) => entry.label),
      );
      if (draggedSiteNames.size === 0) {
        onNotify?.('ドラッグ元の現場が見つかりません');
        return;
      }

      if (beforeGroups.length >= MAX_CELL_GROUPS) {
        onNotify?.('満杯のため追加できません（4枠あり）');
        return;
      }

      const hasDuplicate = beforeGroups.some((group) =>
        group.items.some((entry) => isSiteCellEntry(entry) && draggedSiteNames.has(entry.label)),
      );
      if (hasDuplicate) {
        onNotify?.('ドラッグ元の枠に含まれる現場がすでに登録済みです');
        return;
      }

      const result = await persistCellSet({
        targetUser: user,
        day: input.day,
        beforeCell,
        nextCell: groupsToApiCell([...beforeGroups, draggedGroup]),
      });
      if (result.failed) {
        onNotify?.(result.message ? `操作に失敗しました: ${result.message}` : '通信に失敗しました');
        return;
      }
      if (!result.changed) {
        onNotify?.('変更はありません');
        return;
      }

      onSetDraggedCell?.(null);
      onNotify?.('枠を追加しました');
      void Promise.resolve(onAssigned()).catch(() => undefined);
    },
    [onAssigned, onNotify, onSetDraggedCell, persistCellSet, user],
  );

  const renderedDayCells = useMemo(
    () =>
      dayLabels.map((d) => {
        const cell = grid[d.key];
        const beforeCell = cloneApiCell(cell);
        const beforeGroups = apiCellToGroups(beforeCell);
        const hasAnyEntry = beforeGroups.length > 0;
        const isHighlight = historyHover && historyHover.userId === user.id && historyHover.day === d.key;
        const isPaceTarget = paceTargetUserId === user.id && Boolean(paceTargetDays?.has(d.key));

        return (
          <div
            key={d.key}
            role="button"
            tabIndex={0}
            data-testid={`cell-${user.id}-${d.key}`}
            data-cell-day={d.key}
            onDragOver={(e) => {
              if (!isEditable || (!draggedSite && !draggedCell)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              if (!isEditable) return;
              e.preventDefault();

              if (draggedSite) {
                void runCellAction({
                  day: d.key,
                  action: 'add',
                  color: cellTextColor,
                  siteId: draggedSite.id,
                  siteName: siteStoredName(draggedSite) || draggedSite.label,
                  beforeCell,
                  allowSiblingMerge: false,
                });
              } else if (draggedCell && (draggedCell.userId !== user.id || draggedCell.day !== d.key)) {
                void applyDraggedGroup({ day: d.key, beforeCell, dragged: draggedCell });
              }
            }}
            onClick={(e) => {
              if (!isEditable) {
                onNotify?.('編集するには、ヘッダーの「編集」から開始してください');
                return;
              }

              e.preventDefault();

              if (selectedCell && selectedCell.userId === user.id && selectedCell.day === d.key) {
                openInlineEditor({ day: d.key, cell: beforeCell });
                onSetSelectedCell?.(null);
              } else if (selectedSite || cellClickAction === 'swap') {
                void runCellAction({
                  day: d.key,
                  action: cellClickAction,
                  color: cellTextColor,
                  beforeCell,
                });
              } else {
                onSetSelectedCell?.({ userId: user.id, day: d.key });
              }
            }}
            onDoubleClick={(e) => {
              if (!isEditable) return;
              e.preventDefault();
              e.stopPropagation();
              openInlineEditor({ day: d.key, cell: beforeCell });
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (!isEditable) {
                onNotify?.('編集するには、ヘッダーの「編集」から開始してください');
                return;
              }
              if (selectedCell && selectedCell.userId === user.id && selectedCell.day === d.key) {
                openInlineEditor({ day: d.key, cell: beforeCell });
                onSetSelectedCell?.(null);
              } else if (selectedSite || cellClickAction === 'swap') {
                void runCellAction({
                  day: d.key,
                  action: cellClickAction,
                  color: cellTextColor,
                  beforeCell,
                });
              } else {
                onSetSelectedCell?.({ userId: user.id, day: d.key });
              }
            }}
            title={isPaceTarget ? 'ペース対象日' : undefined}
            className={`relative border-b border-l border-zinc-400 px-2 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-900 ${
              isHighlight ? 'ring-2 ring-red-500 ring-inset' : ''
            } ${selectedCell?.userId === user.id && selectedCell?.day === d.key ? 'ring-2 ring-blue-500 ring-inset' : ''} ${
              rowCellClassName ?? ''
            } ${isPaceTarget ? 'shadow-[inset_0_0_0_1px_rgba(245,158,11,0.6)]' : ''} ${
              isPaceTarget && !hasAnyEntry ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''
            }`}
          >
            {isPaceTarget ? (
              <span className="pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 dark:bg-amber-300" aria-hidden="true" />
            ) : null}
            <div style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}>
              {editingCell?.userId === user.id && editingCell?.day === d.key ? (
                <div data-inline-editor className="relative" onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const editingGroup = apiCellToGroups(beforeCell)[editingCell.slotIndex] ?? null;
                    const editableSiteTargets = (editingGroup?.items ?? [])
                      .map((entry, itemIndex) => {
                        if (!isSiteCellEntry(entry)) return null;
                        const site = resolveStoredSite(entry.label);
                        return {
                          itemIndex,
                          label: entry.label,
                          displayLabel: siteFamilyDisplayName(siteStoredName(site) || entry.label),
                        };
                      })
                      .filter((item): item is { itemIndex: number; label: string; displayLabel: string } => !!item);
                    const selectedTargetItemIndex =
                      typeof editingCell.targetItemIndex === 'number'
                        ? editingCell.targetItemIndex
                        : editableSiteTargets[0]?.itemIndex ?? 0;
                    return editingCell.source === 'button' && editableSiteTargets.length > 1 ? (
                      <label className="mb-1 block text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span className="mb-0.5 block">編集する現場</span>
                        <select
                          value={String(selectedTargetItemIndex)}
                          onChange={(event) => {
                            const nextTargetItemIndex = Number.parseInt(event.target.value, 10);
                            const nextTarget = editableSiteTargets.find((item) => item.itemIndex === nextTargetItemIndex) ?? null;
                            if (!nextTarget) return;
                            setEditingCell?.({ ...editingCell, targetItemIndex: nextTarget.itemIndex });
                            setEditingInput?.(nextTarget.label);
                            setSiteSuggestions?.([]);
                          }}
                          className="w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        >
                          {editableSiteTargets.map((item) => (
                            <option key={`edit-target:${user.id}:${d.key}:${item.itemIndex}`} value={item.itemIndex}>
                              {item.displayLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null;
                  })()}
                  <input
                    type="text"
                    value={editingInput ?? ''}
                    onChange={(e) => setEditingInput?.(e.target.value)}
                    onKeyDown={(e) => {
                      const editingSlotIndex =
                        editingCell?.userId === user.id && editingCell?.day === d.key ? editingCell.slotIndex : 0;
                      const editingTargetItemIndex =
                        editingCell?.userId === user.id && editingCell?.day === d.key ? editingCell.targetItemIndex : null;
                      if (e.key === 'Escape') {
                        setEditingCell?.(null);
                        setEditingInput?.('');
                        setSiteSuggestions?.([]);
                      } else if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (siteSuggestions && siteSuggestions.length > 0) {
                          const site = siteSuggestions[0];
                          setEditingCell?.(null);
                          setEditingInput?.('');
                          setSiteSuggestions?.([]);
                          void commitInlineEdit({
                            day: d.key,
                            slotIndex: editingSlotIndex,
                            targetItemIndex: editingTargetItemIndex,
                            beforeCell,
                            siteId: site.id,
                            siteName: siteStoredName(site) || site.label,
                          });
                        } else if (editingInput?.trim()) {
                          const siteName = (editingInput ?? '').trim();
                          setEditingCell?.(null);
                          setEditingInput?.('');
                          setSiteSuggestions?.([]);
                          void commitInlineEdit({
                            day: d.key,
                            slotIndex: editingSlotIndex,
                            targetItemIndex: editingTargetItemIndex,
                            beforeCell,
                            siteName,
                          });
                        }
                      }
                    }}
                    autoFocus
                    className="w-full rounded border border-blue-500 bg-white px-1 py-0.5 text-xs dark:bg-black"
                    placeholder="現場名を入力..."
                  />
                  {editingCell.source === 'button' ? (
                    <div className="mt-1 flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditingCell?.(null);
                          setEditingInput?.('');
                          setSiteSuggestions?.([]);
                        }}
                        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        閉じる
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const editingSlotIndex =
                            editingCell?.userId === user.id && editingCell?.day === d.key ? editingCell.slotIndex : 0;
                          const editingTargetItemIndex =
                            editingCell?.userId === user.id && editingCell?.day === d.key ? editingCell.targetItemIndex : null;
                          const siteName = (editingInput ?? '').trim();
                          if (!siteName) return;
                          setEditingCell?.(null);
                          setEditingInput?.('');
                          setSiteSuggestions?.([]);
                          void commitInlineEdit({
                            day: d.key,
                            slotIndex: editingSlotIndex,
                            targetItemIndex: editingTargetItemIndex,
                            beforeCell,
                            siteName,
                          });
                        }}
                        disabled={!(editingInput ?? '').trim()}
                        className="rounded border border-blue-600 bg-blue-600 px-2 py-0.5 text-[10px] text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:border-zinc-700 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
                      >
                        反映
                      </button>
                    </div>
                  ) : null}
                  {editingCell.source !== 'button' && siteSuggestions && siteSuggestions.length > 0 ? (
                    <div
                      data-suggestion-list
                      className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full min-w-[200px] overflow-auto rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {siteSuggestions.map((site: SiteItem) => (
                        <button
                          key={site.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingCell?.(null);
                            setEditingInput?.('');
                            setSiteSuggestions?.([]);
                            const editingSlotIndex =
                              editingCell?.userId === user.id && editingCell?.day === d.key ? editingCell.slotIndex : 0;
                            void commitInlineEdit({
                              day: d.key,
                              slotIndex: editingSlotIndex,
                              targetItemIndex: editingCell?.userId === user.id && editingCell?.day === d.key ? editingCell.targetItemIndex : null,
                              beforeCell,
                              siteId: site.id,
                              siteName: siteStoredName(site) || site.label,
                            });
                          }}
                          className="w-full px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          {site.label}
                        </button>
                      ))}
                    </div>
                  ) : suggestionLoading ? (
                    <div className="absolute left-0 top-full z-50 mt-1 w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                      検索中...
                    </div>
                  ) : null}
                </div>
              ) : (
                <>{renderCellLabels(cell, d.key, beforeCell)}</>
              )}
            </div>
          </div>
        );
      }),
    [
      cellClickAction,
      cellMinH,
      cellTextColor,
      dayLabels,
      draggedCell,
      draggedSite,
      editingCell,
      editingInput,
      grid,
      historyHover,
      isEditable,
      onNotify,
      onSetSelectedCell,
      paceTargetDays,
      paceTargetUserId,
      applyDraggedGroup,
      commitInlineEdit,
      renderCellLabels,
      rowCellClassName,
      openInlineEditor,
      runCellAction,
      selectedCell,
      selectedSite,
      setEditingCell,
      setEditingInput,
      resolveStoredSite,
      setSiteSuggestions,
      siteSuggestions,
      suggestionLoading,
      user.id,
    ],
  );

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectUser(isSelectedUser ? null : user.id)}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onSelectUser(isSelectedUser ? null : user.id);
        }}
        data-user-row={user.id}
        data-user-kind={apiKind}
        data-user-label={(user.name ?? user.email ?? user.id).trim()}
        data-testid={`user-row-${user.id}`}
        aria-current={isSelectedUser ? 'true' : undefined}
        className={`sticky left-0 z-10 border-b border-r border-zinc-400 bg-white px-1.5 py-2 text-left text-[13px] dark:border-zinc-600 dark:bg-black relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-zinc-400 dark:after:bg-zinc-600 sm:px-2 ${
          isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : ''
        }`}
      >
        <div
          className="flex items-start justify-between gap-2"
          style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}
        >
          <div
            data-user-label
            className={`min-w-0 truncate font-medium ${isCurrentUser ? 'text-red-500 dark:text-red-300' : ''}`}
          >
            {user.name ?? user.email ?? user.id}
          </div>
          {reorderMode ? (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={moveUpDisabled}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onMoveUp?.();
                  }}
                  className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="上へ"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={moveDownDisabled}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onMoveDown?.();
                  }}
                  className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="下へ"
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onDeleteUser?.();
                }}
                className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                aria-label="削除"
              >
                削除
              </button>
            </div>
          ) : null}
        </div>
        {onStartNameColResize ? <ColumnResizeHandle onPointerDown={onStartNameColResize} /> : null}
      </div>
      {renderedDayCells}
      {slotContextMenu ? (
        <div
          ref={contextMenuRef}
          className="fixed z-[90] min-w-[260px] max-w-[min(92vw,320px)] rounded-lg border border-zinc-200 bg-white p-2 text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
          style={{ left: `${slotContextMenu.x}px`, top: `${slotContextMenu.y}px` }}
          onWheelCapture={() => {
            lastContextMenuWheelAtRef.current = Date.now();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="border-b border-zinc-200 px-1 pb-2 dark:border-zinc-800">
            <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
              {slotContextMenu.entryKind === 'note' ? `追記: ${slotContextMenu.siteName}` : slotContextMenu.siteName}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">{slotContextMenu.day}</div>
          </div>

          {slotContextMenu.mode === 'actions' ? (
            <div className="mt-2 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setSlotContextMenu((current) => (current ? { ...current, mode: 'change-color' } : current));
                }}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                {slotContextMenu.entryKind === 'site' ? '当該現場の色変更' : '当該追記の色変更'}
              </button>
              {slotContextMenu.entryKind === 'site' ? (
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSlotContextMenu((current) =>
                        current
                          ? {
                              ...current,
                              mode: 'append-note',
                              noteDraft: current.groupNote ?? '',
                            }
                          : current,
                      );
                    }}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    追加記入
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const current = slotContextMenu;
                      setSlotContextMenu(null);
                      openInlineEditor({
                        day: current.day,
                        cell: current.beforeCell,
                        preferredGroupIndex: current.groupIndex,
                        source: 'button',
                      });
                    }}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    編集
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSlotContextMenu((current) =>
                      current
                        ? {
                            ...current,
                            mode: 'append-note',
                            noteDraft: getNoteGroupEditorDraft(current.beforeCell, current.groupIndex),
                          }
                        : current,
                    );
                  }}
                  className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  追記を編集
                </button>
              )}
              {slotContextMenu.entryKind === 'site' ? (
              <button
                type="button"
                onClick={() => {
                  setSlotContextMenu((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      mode: 'assign-users',
                      selectedUserIds: assignedUserIdsForSite(current.day, current.siteName),
                    };
                  });
                }}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                同日・同現場の従業員を選択
              </button>
              ) : null}
              {slotContextMenu.entryKind === 'site' && slotContextRelatedSiteOptions.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSlotContextMenu((current) => {
                      if (!current) return current;
                      return {
                        ...current,
                        mode: 'related-sites',
                        selectedSiblingNames: siblingEntryNamesForSite(current.day, current.siteName),
                      };
                    });
                  }}
                  className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  同名別店舗を選択
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void removeSlotContextGroup();
                }}
                className="w-full rounded-md border border-red-200 px-3 py-2 text-left text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                当該枠をセルから削除
              </button>
            </div>
          ) : slotContextMenu.mode === 'change-color' ? (
            <div className="mt-2 space-y-2">
              <div className="text-[11px] text-zinc-600 dark:text-zinc-300">今回だけの色変更</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void applySlotContextGroupColor('red');
                  }}
                  className={`rounded-md border px-3 py-2 text-left ${
                    slotContextMenu.color === 'red'
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                  }`}
                >
                  赤
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void applySlotContextGroupColor('default');
                  }}
                  className={`rounded-md border px-3 py-2 text-left ${
                    slotContextMenu.color === 'default'
                      ? 'border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                  }`}
                >
                  黒
                </button>
              </div>
              {slotContextMenu.entryKind === 'site' ? (
                <>
                  <div className="pt-1 text-[11px] text-zinc-600 dark:text-zinc-300">当該現場の以降のデフォルト</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void applySlotContextSiteDefaultColor('red');
                      }}
                      className={`rounded-md border px-3 py-2 text-left ${
                        slotContextDefaultSiteColor === 'red'
                          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                          : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                      }`}
                    >
                      デフォルトの赤
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void applySlotContextSiteDefaultColor('default');
                      }}
                      className={`rounded-md border px-3 py-2 text-left ${
                        slotContextDefaultSiteColor === 'default'
                          ? 'border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100'
                          : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                      }`}
                    >
                      デフォルトの黒
                    </button>
                  </div>
                </>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSlotContextMenu((current) => (current ? { ...current, mode: 'actions' } : current));
                  }}
                  className="rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  戻る
                </button>
              </div>
            </div>
          ) : slotContextMenu.mode === 'assign-users' ? (
            <div className="mt-2">
              <div className="mb-2 text-[11px] text-zinc-600 dark:text-zinc-300">同日・同現場に入れる従業員を複数選択</div>
              <div className="max-h-56 space-y-1 overflow-auto overscroll-contain pr-1">
                {slotContextUserOptions.map((option) => (
                  <button
                    key={option.userId}
                    type="button"
                    role="checkbox"
                    aria-checked={slotContextSelectedUserIds.has(option.userId)}
                    disabled={option.disabled}
                    onClick={() => {
                      if (option.disabled) return;
                      toggleSlotContextUser(option.userId);
                    }}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                      option.disabled
                        ? 'border-zinc-100 bg-zinc-50 text-zinc-400 dark:border-zinc-900 dark:bg-zinc-900/60 dark:text-zinc-500'
                        : slotContextSelectedUserIds.has(option.userId)
                          ? 'border-blue-200 bg-blue-50/80 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100'
                          : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] font-semibold leading-none transition ${
                        slotContextSelectedUserIds.has(option.userId)
                          ? 'border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-zinc-950'
                          : option.disabled
                            ? 'border-zinc-300 bg-zinc-100 text-transparent dark:border-zinc-700 dark:bg-zinc-800'
                            : 'border-zinc-400 bg-white text-transparent dark:border-zinc-500 dark:bg-zinc-950'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.userLabel}</span>
                    {option.disabled ? (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">枠上限</span>
                    ) : slotContextSelectedUserIds.has(option.userId) ? (
                      <span className="text-[10px] text-blue-700 dark:text-blue-300">選択中</span>
                    ) : option.hasSite ? (
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400">登録済み</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSlotContextMenu((current) => (current ? { ...current, mode: 'actions' } : current));
                  }}
                  className="rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void applySelectedUsersToSite();
                  }}
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                >
                  決定
                </button>
              </div>
            </div>
          ) : slotContextMenu.mode === 'append-note' ? (
            <div className="mt-2 space-y-2">
              <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                {slotContextMenu.entryKind === 'site' ? 'この枠の表示名へ追記します' : 'この追記を編集します'}
              </div>
              <input
                type="text"
                value={slotContextMenu.noteDraft}
                onChange={(event) => {
                  const value = event.target.value;
                  setSlotContextMenu((current) => (current && current.mode === 'append-note' ? { ...current, noteDraft: value } : current));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setSlotContextMenu((current) => (current ? { ...current, mode: 'actions' } : current));
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void applySlotContextNote();
                  }
                }}
                autoFocus
                maxLength={200}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                placeholder={slotContextMenu.entryKind === 'site' ? '例: 午後は資材待ち' : '例: 資材待ち'}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSlotContextMenu((current) => (current ? { ...current, mode: 'actions' } : current));
                  }}
                  className="rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void applySlotContextNote();
                  }}
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                >
                  {slotContextMenu.entryKind === 'site' ? '保存' : '更新'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <div className="mb-2 text-[11px] text-zinc-600 dark:text-zinc-300">同名別店舗をチェック選択</div>
              <div className="max-h-56 space-y-1 overflow-auto overscroll-contain pr-1">
                {slotContextRelatedSiteOptions.map((option) => (
                  (() => {
                    const selectedOrder = slotContextSelectedSiblingOrder.get(option.storedName);
                    const isChecked = slotContextSelectedSiblingNameSet.has(option.storedName);
                    return (
                  <button
                    key={option.storedName}
                    type="button"
                    role="checkbox"
                    aria-checked={isChecked}
                    disabled={option.disabled}
                    onClick={() => {
                      if (option.disabled) return;
                      toggleSlotContextSibling(option.storedName);
                    }}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                      option.disabled
                        ? 'border-zinc-100 bg-zinc-50 text-zinc-400 dark:border-zinc-900 dark:bg-zinc-900/60 dark:text-zinc-500'
                        : isChecked
                          ? 'border-blue-200 bg-blue-50/80 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100'
                        : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-4 shrink-0 text-center text-[11px] font-semibold tabular-nums leading-none ${
                        selectedOrder != null
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-transparent'
                      }`}
                    >
                      {selectedOrder ?? '0'}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] font-semibold leading-none transition ${
                        isChecked
                          ? 'border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-zinc-950'
                          : option.disabled
                            ? 'border-zinc-300 bg-zinc-100 text-transparent dark:border-zinc-700 dark:bg-zinc-800'
                            : 'border-zinc-400 bg-white text-transparent dark:border-zinc-500 dark:bg-zinc-950'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.displayName}</span>
                    {option.disabled ? (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">枠上限</span>
                    ) : selectedOrder != null ? (
                      <span className="text-[10px] text-blue-700 dark:text-blue-300">{selectedOrder}番目</span>
                    ) : null}
                  </button>
                    );
                  })()
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSlotContextMenu((current) => (current ? { ...current, mode: 'actions' } : current));
                  }}
                  className="rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void applySelectedSiblingSites();
                  }}
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                >
                  決定
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

function ScheduleHistoryPanel({
  embedded,
  items,
  total,
  loading,
  error,
  search,
  onSearchChange,
  targetFilter,
  onTargetFilterChange,
  onItemHover,
  onRefresh,
}: {
  embedded?: boolean;
  items: ScheduleChangeHistoryItem[];
  total: number;
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  targetFilter: 'all' | 'スケジュール' | 'カラー';
  onTargetFilterChange: (value: 'all' | 'スケジュール' | 'カラー') => void;
  onItemHover?: (hover: { userId: string; day: string } | null) => void;
  onRefresh: () => void;
}) {
  return (
      <div
        className={embedded
          ? 'flex max-h-[70vh] flex-col overflow-hidden'
          : 'relative flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black'}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">スケジュール変更履歴</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{items.length}件表示 / 全{total}件</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              再読込
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="編集前、編集後、編集者で検索"
            className="min-w-64 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <select
            value={targetFilter}
            onChange={(event) =>
              onTargetFilterChange(
                event.target.value === 'スケジュール' || event.target.value === 'カラー' ? event.target.value : 'all',
              )
            }
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          >
            <option value="all">すべて</option>
            <option value="スケジュール">スケジュール</option>
            <option value="カラー">カラー</option>
          </select>
        </div>

        <div className="overflow-auto px-4 py-3">
          {loading ? <div className="py-6 text-sm text-zinc-500 dark:text-zinc-400">読み込み中…</div> : null}
          {!loading && error ? <div className="py-6 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
          {!loading && !error && items.length === 0 ? (
            <div className="py-6 text-sm text-zinc-500 dark:text-zinc-400">履歴はまだありません。</div>
          ) : null}
          {!loading && !error && items.length > 0 ? (
            <table className="min-w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-2 py-2 font-medium">対象セル</th>
                  <th className="px-2 py-2 font-medium">編集前</th>
                  <th className="px-2 py-2 font-medium">編集後</th>
                  <th className="px-2 py-2 font-medium">誰が</th>
                  <th className="px-2 py-2 font-medium">いつ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-zinc-100 align-top hover:bg-red-50/30 dark:border-zinc-900 dark:hover:bg-red-950/10"
                    onPointerEnter={() => onItemHover?.({ userId: item.targetUserId, day: item.dayYmd })}
                    onPointerLeave={() => onItemHover?.(null)}
                  >
                    <td className="px-2 py-3">
                      <div className="text-zinc-800 dark:text-zinc-100">{item.dayYmd}</div>
                      <div className="mt-1 text-zinc-500 dark:text-zinc-400">{item.targetUserLabel}</div>
                    </td>
                    <td className="px-2 py-3 text-zinc-700 dark:text-zinc-300">{renderHistoryCellValue(item.beforeValue, item.beforeGroups)}</td>
                    <td className="px-2 py-3 text-zinc-700 dark:text-zinc-300">{renderHistoryCellValue(item.afterValue, item.afterGroups)}</td>
                    <td className="px-2 py-3">
                      <div className="text-zinc-800 dark:text-zinc-100">{item.editorLabel}</div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="text-zinc-800 dark:text-zinc-100">{formatHistoryDateTime(item.createdAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
  );
}
