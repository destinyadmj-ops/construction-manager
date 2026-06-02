'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  personalScheduleSwatchClass,
  type PersonalScheduleSummaryDay,
} from '@/shared/personal-schedule';
import { formatScheduleCellGroupDisplayValue, normalizeScheduleCellEntryKind } from '@/shared/schedule-cell-entry';
import {
  buildDayColumnTrack,
  buildLegacyWeekGridPrefsSettingsKey,
  buildNameColumnTrack,
  buildWeekGridPrefsLocalStorageKey,
  buildWeekGridPrefsSettingsKey,
  defaultWeekGridPrefs,
  normalizeWeekGridPrefs,
  type WeekGridPrefs,
} from '@/shared/week-grid-prefs';
import { readStoredScheduleReturn, writeStoredScheduleReturn } from '@/shared/schedule-return';

type ScheduleKind = 'normal' | 'daily';
type MobileTab = 'week' | 'personal';
const LABEL_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
type LabelColor = (typeof LABEL_COLORS)[number];

type AuthMeUser = {
  id: string;
  name: string | null;
  email: string | null;
  kind?: 'NORMAL' | 'DAILY' | null;
};

type ApiUser = {
  id: string;
  name: string | null;
  email: string | null;
};

type ApiCell = {
  slot1: string | null;
  slot2: string | null;
  color1?: LabelColor | null;
  color2?: LabelColor | null;
  groups?: Array<{
    items: Array<{ label: string; color?: LabelColor | null; kind?: string | null }>;
    note?: string | null;
  }>;
};

type ApiResponse = {
  ok: true;
  weekStart: string;
  days: string[];
  users: ApiUser[];
  grid: Record<string, Record<string, ApiCell>>;
};

type SiteItem = {
  id: string;
  companyName?: string | null;
  name: string;
  scheduleLabelColor?: LabelColor | null;
};

type ScheduleEntryDisplay = {
  entry: string;
  color: LabelColor;
};

type NormalizedCellGroup = {
  items: Array<{ label: string; color: LabelColor; kind: string | null }>;
  note: string | null;
};

type ScheduleEntryTarget = {
  entry: string;
  color: LabelColor;
  siteId: string | null;
  noteOnly: boolean;
};

type LinkedScheduleEntryTarget = {
  entry: string;
  color: LabelColor;
  siteId: string;
  noteOnly: boolean;
};

type CellEntryMenuState = {
  title: string;
  items: ScheduleEntryTarget[];
  top: number;
  left: number;
  width: number;
};

type PersonalScheduleMenuState = {
  title: string;
  dayYmd: string;
  count: number;
  items: PersonalScheduleSummaryDay['items'];
  top: number;
  left: number;
  width: number;
};

type PersonalScheduleSummaryApiResponse = {
  ok: true;
  month: string;
  summary: Record<string, Record<string, PersonalScheduleSummaryDay>>;
};

type JsonObject = Record<string, unknown>;

type SiteLookupValue = {
  siteId: string;
  color: LabelColor;
};

type MobileWeekHubHistoryState = {
  v: 1;
  cursorDate: string;
};

const MOBILE_WEEK_HUB_HISTORY_STATE_KEY = 'masterHub.mobileWeekHubState';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

function normalizeScheduleKind(kind: AuthMeUser['kind']): ScheduleKind {
  return kind === 'DAILY' ? 'daily' : 'normal';
}

function readRequestedScheduleKind(searchParams: ReturnType<typeof useSearchParams>): ScheduleKind | null {
  const raw = (searchParams.get('kind') ?? '').trim().toLowerCase();
  return raw === 'daily' ? 'daily' : raw === 'normal' ? 'normal' : null;
}

function userLabel(user: ApiUser | AuthMeUser | null) {
  if (!user) return '未ログイン';
  return (user.name ?? user.email ?? user.id).trim();
}

function orderUsers(users: ApiUser[], order: string[]) {
  if (!order || order.length === 0) return users;
  const byId = new Map(users.map((user) => [user.id, user] as const));
  const used = new Set<string>();
  const next: ApiUser[] = [];

  for (const id of order) {
    const user = byId.get(id);
    if (!user) continue;
    next.push(user);
    used.add(id);
  }

  for (const user of users) {
    if (used.has(user.id)) continue;
    next.push(user);
  }

  return next;
}

function parseUserOrder(raw: unknown) {
  const arr = Array.isArray(raw) ? (raw as unknown[]) : [];
  return arr
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 1000);
}

function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === 'string' && (LABEL_COLORS as readonly string[]).includes(value);
}

function resolveSiteLabelColor(site: SiteItem | null | undefined, fallback: LabelColor = 'default'): LabelColor {
  return isLabelColor(site?.scheduleLabelColor) ? site.scheduleLabelColor : fallback;
}

function labelTextClass(color: LabelColor): string {
  if (color === 'default') return 'text-zinc-800 dark:text-zinc-200';
  if (color === 'red') return 'text-red-600 dark:text-red-400';
  if (color === 'orange') return 'text-orange-600 dark:text-orange-400';
  if (color === 'yellow') return 'text-amber-600 dark:text-amber-300';
  if (color === 'green') return 'text-green-600 dark:text-green-400';
  if (color === 'blue') return 'text-blue-600 dark:text-blue-400';
  if (color === 'purple') return 'text-violet-600 dark:text-violet-400';
  return 'text-pink-600 dark:text-pink-400';
}

function groupDisplayEntry(group: NormalizedCellGroup): ScheduleEntryDisplay | null {
  const labels = group.items.map((entry) => entry.label.trim()).filter((entry) => entry.length > 0);
  const entry = formatScheduleCellGroupDisplayValue(labels, group.note) ?? '';
  if (!entry) return null;
  return {
    entry,
    color: group.items[0]?.color ?? 'default',
  };
}

function cellEntries(cell: ApiCell | null | undefined): ScheduleEntryDisplay[] {
  return cellGroups(cell)
    .map((group) => groupDisplayEntry(group))
    .filter((entry): entry is ScheduleEntryDisplay => Boolean(entry?.entry));
}

function describeScheduleEntry(entry: string) {
  const trimmed = entry.trim();
  const noteOnlyMatch = trimmed.match(/^追記[:：]\s*(.+)$/u);
  if (noteOnlyMatch) {
    return {
      mainText: '',
      noteText: noteOnlyMatch[1]?.trim() ?? '',
      noteOnly: true,
    };
  }

  const appendedNoteMatch = trimmed.match(/^(.*?)[（(]追記[:：]\s*(.*?)[）)]$/u);
  if (appendedNoteMatch) {
    const mainText = appendedNoteMatch[1]?.trim() ?? '';
    const noteText = appendedNoteMatch[2]?.trim() ?? '';
    if (mainText && noteText) {
      return {
        mainText,
        noteText,
        noteOnly: false,
      };
    }
  }

  return {
    mainText: trimmed,
    noteText: null,
    noteOnly: false,
  };
}

function renderScheduleEntryLabel(entry: string, color: LabelColor = 'default') {
  const described = describeScheduleEntry(entry);
  if (!described.noteText) return <span className={labelTextClass(color)}>{entry}</span>;
  if (described.noteOnly || !described.mainText) {
    return <span className="text-red-600 dark:text-red-400">{`追記: ${described.noteText}`}</span>;
  }
  return (
    <>
      <span className={labelTextClass(color)}>{described.mainText}</span>
      <span className="text-red-600 dark:text-red-400">{`（追記: ${described.noteText}）`}</span>
    </>
  );
}

function cellGroups(cell: ApiCell | null | undefined): NormalizedCellGroup[] {
  if (Array.isArray(cell?.groups)) {
    return cell.groups
      .map((group) => {
        if (!group || !Array.isArray(group.items)) return null;
        const items = group.items
          .map((entry) => {
            const label = typeof entry?.label === 'string' ? entry.label.trim() : '';
            if (!label) return null;
            return {
              label,
              color: isLabelColor(entry?.color) ? entry.color : 'default',
              kind: typeof entry?.kind === 'string' ? entry.kind : null,
            };
          })
          .filter((entry): entry is { label: string; color: LabelColor; kind: string | null } => !!entry)
          .slice(0, 4);
        if (items.length === 0) return null;
        return {
          items,
          note: typeof group.note === 'string' ? group.note.trim() || null : null,
        };
      })
      .filter((group): group is NormalizedCellGroup => !!group)
      .slice(0, 4);
  }

  return [cell?.slot1 ?? null, cell?.slot2 ?? null]
    .map((entry, index) => ({
      label: (entry ?? '').trim(),
      color: isLabelColor(index === 0 ? cell?.color1 : cell?.color2) ? (index === 0 ? cell?.color1 : cell?.color2) : 'default',
    }))
    .filter((entry): entry is { label: string; color: LabelColor } => entry.label.length > 0)
    .map((entry) => ({ items: [{ label: entry.label, color: entry.color, kind: 'site' as const }], note: null }));
}

function resolveScheduleGroupTargets(
  group: NormalizedCellGroup,
  siteLookupByScheduleEntry: Map<string, SiteLookupValue>,
): ScheduleEntryTarget[] {
  const itemTargets = group.items.map<ScheduleEntryTarget>((entry) => {
    const matchedSite = normalizeScheduleCellEntryKind(entry.kind) === 'site'
      ? siteLookupByScheduleEntry.get(normalizeSiteLookupKey(entry.label)) ?? null
      : null;

    return {
      entry:
        normalizeScheduleCellEntryKind(entry.kind) === 'site'
          ? entry.label
          : `追記: ${entry.label}`,
      color: matchedSite?.color ?? entry.color,
      siteId: matchedSite?.siteId ?? null,
      noteOnly: normalizeScheduleCellEntryKind(entry.kind) !== 'site',
    };
  });

  if (!group.note) return itemTargets;

  return [
    ...itemTargets,
    {
      entry: `追記: ${group.note}`,
      color: 'default',
      siteId: null,
      noteOnly: true,
    },
  ];
}

function cellSiteNames(cell: ApiCell | null | undefined) {
  return cellGroups(cell)
    .flatMap((group) =>
      group.items
        .filter((entry) => normalizeScheduleCellEntryKind(entry.kind) === 'site')
        .map((entry) => entry.label.trim()),
    )
    .filter((entry): entry is string => entry.length > 0);
}

function normalizeSiteLookupKey(value: string) {
  return value
    .replace(/（追記[:：].*?）$/u, '')
    .replace(/\(追記[:：].*?\)$/u, '')
    .replace(/^追記[:：]\s*/u, '')
    .replace(/\s\+\d+$/, '')
    .trim();
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function normalizeMobileWeekHubHistoryState(raw: unknown): MobileWeekHubHistoryState | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const cursorDate = typeof obj.cursorDate === 'string' ? obj.cursorDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cursorDate)) return null;
  return { v: 1, cursorDate };
}

function readMobileWeekHubHistoryState(): MobileWeekHubHistoryState | null {
  if (typeof window === 'undefined') return null;
  const rawState = window.history.state;
  if (!rawState || typeof rawState !== 'object') return null;
  return normalizeMobileWeekHubHistoryState((rawState as Record<string, unknown>)[MOBILE_WEEK_HUB_HISTORY_STATE_KEY]);
}

function resolveScheduleEntryTargets(entries: ScheduleEntryDisplay[], siteLookupByScheduleEntry: Map<string, SiteLookupValue>): ScheduleEntryTarget[] {
  return entries.flatMap<ScheduleEntryTarget>((entry) => {
    const tokenMatches = entry.entry
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => {
        const matchedSite = siteLookupByScheduleEntry.get(normalizeSiteLookupKey(part));
        return {
          entry: part,
          color: matchedSite?.color ?? entry.color,
          siteId: matchedSite?.siteId ?? null,
          noteOnly: describeScheduleEntry(part).noteOnly,
        };
      })
      .filter(isLinkedScheduleEntryTarget);

    if (tokenMatches.length > 1) {
      return tokenMatches;
    }

    const exactSite = siteLookupByScheduleEntry.get(normalizeSiteLookupKey(entry.entry)) ?? null;
    if (exactSite) {
      return [{ entry: entry.entry, color: exactSite.color, siteId: exactSite.siteId, noteOnly: false }];
    }

    if (tokenMatches.length === 1) {
      return [{ entry: entry.entry, color: tokenMatches[0].color, siteId: tokenMatches[0].siteId, noteOnly: false }];
    }

    return [{ entry: entry.entry, color: entry.color, siteId: null, noteOnly: describeScheduleEntry(entry.entry).noteOnly }];
  });
}

function isLinkedScheduleEntryTarget(target: ScheduleEntryTarget): target is LinkedScheduleEntryTarget {
  return typeof target.siteId === 'string' && target.siteId.length > 0;
}

function resolveScheduleEntryPreview(entries: ScheduleEntryDisplay[], siteLookupByScheduleEntry: Map<string, SiteLookupValue>): ScheduleEntryDisplay {
  for (const entry of entries) {
    const parts = entry.entry
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const part of parts) {
      const matchedSite = siteLookupByScheduleEntry.get(normalizeSiteLookupKey(part));
      if (matchedSite) return { entry: part, color: matchedSite.color };
    }

    if (parts.length > 0) return { entry: parts[0], color: entry.color };
  }

  return { entry: '', color: 'default' };
}

const DOW = ['月', '火', '水', '木', '金', '土', '日'] as const;

export default function MobileWeekHub() {
  return (
    <Suspense fallback={null}>
      <MobileWeekHubInner />
    </Suspense>
  );
}

function MobileWeekHubInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const currentMobileHref = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `/mobile/week-hub?${qs}` : '/mobile/week-hub';
  }, [searchParams]);
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date());
  const [authUser, setAuthUser] = useState<AuthMeUser | null>(null);
  const [schedule, setSchedule] = useState<ApiResponse | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const [weekGridPrefs, setWeekGridPrefs] = useState<WeekGridPrefs>(() => defaultWeekGridPrefs('mobile'));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [cellEntryMenu, setCellEntryMenu] = useState<CellEntryMenuState | null>(null);
  const [personalScheduleSummaryByUser, setPersonalScheduleSummaryByUser] = useState<Record<string, Record<string, PersonalScheduleSummaryDay>>>({});
  const [personalScheduleMenu, setPersonalScheduleMenu] = useState<PersonalScheduleMenuState | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const didInitialHistoryRestoreRef = useRef(false);

  useEffect(() => {
    if (didInitialHistoryRestoreRef.current) return;
    didInitialHistoryRestoreRef.current = true;
    const storedMobileState = (() => {
      const stored = readStoredScheduleReturn();
      if (!stored || stored.target !== 'mobile-week-hub' || stored.href !== currentMobileHref) return null;
      return normalizeMobileWeekHubHistoryState(stored.state);
    })();
    const restoredState = readMobileWeekHubHistoryState() ?? storedMobileState;
    if (!restoredState?.cursorDate) return;
    const restoredDate = new Date(`${restoredState.cursorDate}T00:00:00`);
    if (Number.isNaN(restoredDate.getTime())) return;
    setCursorDate(restoredDate);
  }, [currentMobileHref]);

  const requestedScheduleKind = useMemo(() => readRequestedScheduleKind(searchParams), [searchParams]);

  const scheduleKind = useMemo(
    () => requestedScheduleKind ?? normalizeScheduleKind(authUser?.kind),
    [authUser?.kind, requestedScheduleKind],
  );

  const activeTab = useMemo<MobileTab>(() => {
    if (scheduleKind === 'daily') return 'week';
    const raw = (searchParams.get('tab') ?? '').trim().toLowerCase();
    return raw === 'personal' ? 'personal' : 'week';
  }, [scheduleKind, searchParams]);

  const weekStart = useMemo(() => {
    return startOfWeekMonday(cursorDate);
  }, [cursorDate]);

  const monthWeekTabs = useMemo(() => {
    // Always show 5 weeks centered on the current week
    const center = startOfWeekMonday(new Date(cursorDate));
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(center);
      d.setDate(d.getDate() + (i - 2) * 7);
      return d;
    });
  }, [cursorDate]);

  const weekGridPrefsKey = useMemo(() => buildWeekGridPrefsSettingsKey(scheduleKind, 'week', 'mobile'), [scheduleKind]);
  const legacyWeekGridPrefsKey = useMemo(() => buildLegacyWeekGridPrefsSettingsKey(scheduleKind, 'week'), [scheduleKind]);
  const userOrderKey = useMemo(() => `week-hub:${scheduleKind}:userOrder`, [scheduleKind]);
  const weekGridPrefsLocalStorageKey = useMemo(
    () => buildWeekGridPrefsLocalStorageKey(weekGridPrefsKey, authUser?.id ?? null),
    [authUser?.id, weekGridPrefsKey],
  );
  const legacyWeekGridPrefsLocalStorageKey = useMemo(
    () => buildWeekGridPrefsLocalStorageKey(legacyWeekGridPrefsKey, authUser?.id ?? null),
    [authUser?.id, legacyWeekGridPrefsKey],
  );
  const userOrderLocalStorageKey = useMemo(
    () => (authUser?.id ? `masterHub.userOrder:${authUser.id}:${userOrderKey}` : null),
    [authUser?.id, userOrderKey],
  );
  const weekViewLabel = useMemo(() => (scheduleKind === 'daily' ? '日常予定' : '週予定'), [scheduleKind]);

  const viewMonth = useMemo(() => `${weekStart.getFullYear()}-${pad2(weekStart.getMonth() + 1)}`, [weekStart]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const dayLabels = useMemo(() => {
    return days.map((d, i) => ({
      key: toYmd(d),
      dow: DOW[i],
      dayNum: d.getDate(),
      isSat: i === 5,
      isSun: i === 6,
    }));
  }, [days]);
  const visiblePersonalScheduleMonths = useMemo(
    () => Array.from(new Set(dayLabels.map((day) => day.key.slice(0, 7)))),
    [dayLabels],
  );

  const readWeekGridPrefs = useCallback((localStorageKey: string | null, fallbackLocalStorageKey: string | null = null): WeekGridPrefs => {
    try {
      for (const key of [localStorageKey, fallbackLocalStorageKey]) {
        if (!key) continue;
        const txt = window.localStorage.getItem(key);
        if (!txt) continue;
        return normalizeWeekGridPrefs(JSON.parse(txt) as unknown, defaultWeekGridPrefs('mobile'));
      }
      return defaultWeekGridPrefs('mobile');
    } catch {
      return defaultWeekGridPrefs('mobile');
    }
  }, []);

  const readLocalUserOrder = useCallback((userId: string | null) => {
    if (typeof window === 'undefined') return null;
    const ownerUserId = (userId ?? '').trim();
    if (!ownerUserId) return null;

    try {
      const txt = window.localStorage.getItem(`masterHub.userOrder:${ownerUserId}:${userOrderKey}`);
      if (!txt) return null;
      const raw = JSON.parse(txt) as unknown;
      const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonObject) : null;
      return {
        order: parseUserOrder(payload?.order ?? raw),
        savedAt: typeof payload?.savedAt === 'number' && Number.isFinite(payload.savedAt) ? payload.savedAt : 0,
      };
    } catch {
      return null;
    }
  }, [userOrderKey]);

  const writeLocalUserOrder = useCallback((userId: string | null, order: string[]) => {
    if (typeof window === 'undefined') return;
    const ownerUserId = (userId ?? '').trim();
    if (!ownerUserId) return;
    const savedAt = Date.now();
    const storageKey = `masterHub.userOrder:${ownerUserId}:${userOrderKey}`;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ order, savedAt }));
      window.dispatchEvent(
        new CustomEvent('masterHub:userOrderUpdated', {
          detail: { storageKey, order, savedAt },
        }),
      );
    } catch {
      // ignore
    }
  }, [userOrderKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!userOrderLocalStorageKey || !authUser?.id) return;

    const apply = () => {
      const parsed = readLocalUserOrder(authUser.id);
      if (!parsed) return;
      setUserOrder((current) => {
        const next = parsed.order;
        if (current.length === next.length && current.every((value, index) => value === next[index])) return current;
        return next;
      });
    };

    const onStorage = (event: Event) => {
      if (!(event instanceof StorageEvent)) return;
      if (event.key && event.key !== userOrderLocalStorageKey) return;
      apply();
    };

    const onUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = asObject(event.detail);
      if (typeof detail?.storageKey === 'string' && detail.storageKey !== userOrderLocalStorageKey) return;
      apply();
    };

    window.addEventListener('storage', onStorage as EventListener);
    window.addEventListener('masterHub:userOrderUpdated', onUpdated as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage as EventListener);
      window.removeEventListener('masterHub:userOrderUpdated', onUpdated as EventListener);
    };
  }, [authUser?.id, readLocalUserOrder, userOrderLocalStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsLocalStorageKey, legacyWeekGridPrefsLocalStorageKey));
  }, [legacyWeekGridPrefsLocalStorageKey, readWeekGridPrefs, weekGridPrefsLocalStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const apply = (event?: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key && event.key !== weekGridPrefsLocalStorageKey) return;
      }

      if (event instanceof CustomEvent) {
        const detail = asObject(event.detail);
        if (typeof detail?.storageKey === 'string' && detail.storageKey !== weekGridPrefsLocalStorageKey) return;
        if (detail?.value) {
          setWeekGridPrefs(normalizeWeekGridPrefs(detail.value, defaultWeekGridPrefs('mobile')));
          return;
        }
      }

      setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsLocalStorageKey, legacyWeekGridPrefsLocalStorageKey));
    };

    window.addEventListener('masterHub:gridPrefsUpdated', apply as EventListener);
    window.addEventListener('storage', apply as EventListener);
    return () => {
      window.removeEventListener('masterHub:gridPrefsUpdated', apply as EventListener);
      window.removeEventListener('storage', apply as EventListener);
    };
  }, [legacyWeekGridPrefsLocalStorageKey, readWeekGridPrefs, weekGridPrefsLocalStorageKey]);

  useEffect(() => {
    if (!authUser?.id) {
      if (typeof window !== 'undefined') {
        setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsLocalStorageKey, legacyWeekGridPrefsLocalStorageKey));
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        let loaded = false;
        for (const key of [weekGridPrefsKey, legacyWeekGridPrefsKey]) {
          const r = await fetch(
            `/api/ui-settings?userId=${encodeURIComponent(authUser.id)}&key=${encodeURIComponent(key)}`,
            { cache: 'no-store' },
          );
          const j = (await r.json().catch(() => null)) as unknown;
          const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
          if (!r.ok || obj?.ok !== true) continue;

          const raw = (obj as { value?: unknown }).value;
          const vObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
          const next = normalizeWeekGridPrefs(vObj && typeof vObj.v === 'number' ? vObj : raw, defaultWeekGridPrefs('mobile'));
          if (cancelled) return;
          setWeekGridPrefs(next);
          loaded = true;

          try {
            const localKey = weekGridPrefsLocalStorageKey;
            if (!localKey) return;
            window.localStorage.setItem(localKey, JSON.stringify({ ...(vObj ?? {}), ...next }));
          } catch {
            // ignore
          }
          break;
        }

        if (!loaded) throw new Error('not ok');
      } catch {
        if (cancelled || typeof window === 'undefined') return;
        setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsLocalStorageKey, legacyWeekGridPrefsLocalStorageKey));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authUser?.id,
    legacyWeekGridPrefsKey,
    legacyWeekGridPrefsLocalStorageKey,
    readWeekGridPrefs,
    weekGridPrefsKey,
    weekGridPrefsLocalStorageKey,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const json = (await res.json()) as { ok?: boolean; user?: AuthMeUser | null };
        if (json?.ok !== true) throw new Error('Invalid response');
        setAuthUser(json.user ?? null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAuthUser(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!authUser?.id) {
      setUserOrder([]);
      return;
    }

    let cancelled = false;
    const localValue = readLocalUserOrder(authUser.id);
    if (localValue) {
      setUserOrder(localValue.order);
    }

    void (async () => {
      try {
        const r = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(authUser.id)}&key=${encodeURIComponent(userOrderKey)}`,
          { cache: 'no-store' },
        );
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          if (!cancelled && !localValue) setUserOrder([]);
          return;
        }

        const remoteOrder = parseUserOrder(obj.value);
        const remoteUpdatedAtRaw = typeof obj.updatedAt === 'string' ? Date.parse(obj.updatedAt) : Number.NaN;
        const remoteUpdatedAt = Number.isFinite(remoteUpdatedAtRaw) ? remoteUpdatedAtRaw : 0;
        const nextOrder = localValue && localValue.savedAt > remoteUpdatedAt ? localValue.order : remoteOrder;
        if (cancelled) return;
        setUserOrder(nextOrder);
        writeLocalUserOrder(authUser.id, nextOrder);
      } catch {
        if (!cancelled && !localValue) {
          setUserOrder([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, readLocalUserOrder, userOrderKey, writeLocalUserOrder]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      setError(null);
    });

    Promise.all([
      fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&kind=${encodeURIComponent(scheduleKind)}`, {
        signal: controller.signal,
        cache: 'no-store',
      }),
      fetch(`/api/sites?month=${encodeURIComponent(viewMonth)}&kind=${encodeURIComponent(scheduleKind)}`, {
        signal: controller.signal,
        cache: 'no-store',
      }),
    ])
      .then(async ([scheduleRes, sitesRes]) => {
        if (!scheduleRes.ok) throw new Error(`Failed to load schedule (${scheduleRes.status})`);
        const scheduleJson = (await scheduleRes.json()) as ApiResponse;
        const sitesJson = sitesRes.ok
          ? ((await sitesRes.json()) as { ok?: boolean; sites?: SiteItem[] })
          : null;
        setSchedule(scheduleJson);
        setSites(sitesJson?.ok === true && Array.isArray(sitesJson.sites) ? sitesJson.sites : []);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setSchedule(null);
        setSites([]);
        setError(cause instanceof Error ? cause.message : '予定の取得に失敗しました');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [refreshRevision, scheduleKind, viewMonth, weekStart]);

  const weekPersonalScheduleUserIds = useMemo(
    () => Array.from(new Set((schedule?.users ?? []).map((user) => user.id).filter((userId) => userId.length > 0))),
    [schedule?.users],
  );

  useEffect(() => {
    if (activeTab !== 'week') {
      setPersonalScheduleSummaryByUser({});
      return;
    }
    if (weekPersonalScheduleUserIds.length === 0 || visiblePersonalScheduleMonths.length === 0) {
      setPersonalScheduleSummaryByUser({});
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const monthSummaries = await Promise.all(
          visiblePersonalScheduleMonths.map(async (month) => {
            const response = await fetch(
              `/api/personal-schedule/summary?month=${encodeURIComponent(month)}&userIds=${encodeURIComponent(weekPersonalScheduleUserIds.join(','))}`,
              { signal: controller.signal, cache: 'no-store' },
            );
            if (!response.ok) {
              throw new Error(`Failed to load personal schedule summary (${response.status})`);
            }
            const json = (await response.json()) as PersonalScheduleSummaryApiResponse;
            return json.summary;
          }),
        );

        if (controller.signal.aborted) return;

        const merged = weekPersonalScheduleUserIds.reduce<Record<string, Record<string, PersonalScheduleSummaryDay>>>(
          (accumulator, userId) => {
            accumulator[userId] = {};
            return accumulator;
          },
          {},
        );

        for (const summary of monthSummaries) {
          for (const [userId, byDay] of Object.entries(summary)) {
            merged[userId] = { ...(merged[userId] ?? {}), ...byDay };
          }
        }

        setPersonalScheduleSummaryByUser(merged);
      } catch {
        if (controller.signal.aborted) return;
        setPersonalScheduleSummaryByUser({});
      }
    })();

    return () => controller.abort();
  }, [activeTab, visiblePersonalScheduleMonths, weekPersonalScheduleUserIds]);

  const orderedUsers = useMemo(() => orderUsers(schedule?.users ?? [], userOrder), [schedule?.users, userOrder]);

  const currentUser = (() => {
    if (!authUser || orderedUsers.length === 0) return null;
    return orderedUsers.find((user) => user.id === authUser.id) ?? null;
  })();

  const currentUserGrid = (() => {
    if (!currentUser || !schedule?.grid) return {} as Record<string, ApiCell>;
    return schedule.grid[currentUser.id] ?? {};
  })();

  const assignedSites = useMemo(() => {
    const byName = new Map(
      sites.map((site) => [site.name.trim(), {
        id: site.id,
        label: site.companyName ? `${site.companyName} / ${site.name}` : site.name,
        color: resolveSiteLabelColor(site),
      }]),
    );
    const seen = new Set<string>();
    const items: Array<{ id: string | null; label: string; color: LabelColor }> = [];

    for (const day of dayLabels) {
      const siteNames = cellSiteNames(currentUserGrid[day.key]);
      for (const entry of siteNames) {
        const lookupKey = normalizeSiteLookupKey(entry);
        if (!lookupKey || seen.has(lookupKey)) continue;
        seen.add(lookupKey);
        const matched = byName.get(lookupKey);
        items.push(matched ? matched : { id: null, label: entry, color: 'default' });
      }
    }

    return items;
  }, [currentUserGrid, dayLabels, sites]);

  const siteLookupByScheduleEntry = useMemo(() => {
    const map = new Map<string, SiteLookupValue>();
    for (const site of sites) {
      const key = normalizeSiteLookupKey(site.name.trim());
      if (!key || map.has(key)) continue;
      map.set(key, { siteId: site.id, color: resolveSiteLabelColor(site) });
    }
    return map;
  }, [sites]);

  const closeCellEntryMenu = useCallback(() => {
    setCellEntryMenu(null);
  }, []);

  const closePersonalScheduleMenu = useCallback(() => {
    setPersonalScheduleMenu(null);
  }, []);

  const openCellEntryMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, title: string, items: ScheduleEntryTarget[]) => {
      if (items.length === 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, 220), Math.max(220, viewportWidth - 16));
      const estimatedHeight = Math.min(items.length * 48 + 56, 320);
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const preferredTop = rect.bottom + 8;
      const top = preferredTop + estimatedHeight <= viewportHeight - 8
        ? preferredTop
        : Math.max(8, rect.top - estimatedHeight - 8);

      setPersonalScheduleMenu(null);
      setCellEntryMenu({ title, items, top, left, width });
    },
    [],
  );

  const openPersonalScheduleMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, title: string, dayYmd: string, day: PersonalScheduleSummaryDay) => {
      if (day.count <= 0 || day.items.length === 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(260, rect.width + 120), Math.max(240, viewportWidth - 16));
      const estimatedHeight = Math.min(day.items.length * 56 + 56, 320);
      const left = Math.max(8, Math.min(rect.right - width, viewportWidth - width - 8));
      const preferredTop = rect.bottom + 8;
      const top = preferredTop + estimatedHeight <= viewportHeight - 8
        ? preferredTop
        : Math.max(8, rect.top - estimatedHeight - 8);

      setCellEntryMenu(null);
      setPersonalScheduleMenu({ title, dayYmd, count: day.count, items: day.items, top, left, width });
    },
    [],
  );

  useEffect(() => {
    if (!cellEntryMenu) return;

    const close = () => setCellEntryMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cellEntryMenu]);

  useEffect(() => {
    if (!personalScheduleMenu) return;

    const close = () => setPersonalScheduleMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [personalScheduleMenu]);

  useEffect(() => {
    setCellEntryMenu(null);
    setPersonalScheduleMenu(null);
  }, [activeTab, scheduleKind, weekStart]);

  const handleTabChange = useCallback((tab: MobileTab, nextKind?: ScheduleKind) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    if (nextKind) {
      next.set('kind', nextKind);
    } else {
      next.delete('kind');
    }
    router.replace(`/mobile/week-hub?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleReload = useCallback(() => {
    setRefreshRevision((current) => current + 1);
  }, []);

  const setWeekStartByDate = useCallback((date: Date) => {
    setCursorDate(new Date(date));
  }, []);

  const goPrevMonth = useCallback(() => {
    // Navigate based on the month of the center tab (current displayed week)
    setCursorDate((current) => {
      const center = startOfWeekMonday(new Date(current));
      return new Date(center.getFullYear(), center.getMonth() - 1, 15);
    });
  }, []);

  const goNextMonth = useCallback(() => {
    // Navigate based on the month of the center tab (current displayed week)
    setCursorDate((current) => {
      const center = startOfWeekMonday(new Date(current));
      return new Date(center.getFullYear(), center.getMonth() + 1, 15);
    });
  }, []);

  const rangeLabel = useMemo(() => {
    return `${toYmd(weekStart)}〜${toYmd(addDays(weekStart, 6))}`;
  }, [weekStart]);

  const historySnapshotJsonRef = useRef<string | null>(null);
  const writeMobileWeekHubHistorySnapshot = useCallback((overrides?: Partial<MobileWeekHubHistoryState>) => {
    if (typeof window === 'undefined') return;
    const snapshot: MobileWeekHubHistoryState = {
      v: 1,
      cursorDate: overrides?.cursorDate ?? toYmd(cursorDate),
    };
    const nextJson = JSON.stringify(snapshot);
    if (historySnapshotJsonRef.current === nextJson) return;
    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as Record<string, unknown>)
        : {};
    try {
      window.history.replaceState({ ...currentState, [MOBILE_WEEK_HUB_HISTORY_STATE_KEY]: snapshot }, '', window.location.href);
      writeStoredScheduleReturn({
        target: 'mobile-week-hub',
        href: currentMobileHref,
        state: snapshot,
      });
      historySnapshotJsonRef.current = nextJson;
    } catch {
      // ignore
    }
  }, [currentMobileHref, cursorDate]);

  useEffect(() => {
    writeMobileWeekHubHistorySnapshot();
  }, [writeMobileWeekHubHistorySnapshot]);

  const handleSiteClick = useCallback((siteId: string) => {
    writeMobileWeekHubHistorySnapshot();
    router.push(`/site-ledger/${encodeURIComponent(siteId)}?kind=${encodeURIComponent(scheduleKind)}#punch`);
  }, [router, scheduleKind, writeMobileWeekHubHistorySnapshot]);

  const handleScheduleEntryClick = useCallback((entry: string) => {
    const siteId =
      resolveScheduleEntryTargets([{ entry, color: 'default' }], siteLookupByScheduleEntry).find(isLinkedScheduleEntryTarget)?.siteId ??
      null;
    if (!siteId) return;
    handleSiteClick(siteId);
  }, [handleSiteClick, siteLookupByScheduleEntry]);

  const weekGridCellMinH = useMemo(() => {
    return weekGridPrefs.gridLayout === 'comfortable'
      ? weekGridPrefs.cellMinHComfortable
      : weekGridPrefs.cellMinHCompact;
  }, [weekGridPrefs.cellMinHComfortable, weekGridPrefs.cellMinHCompact, weekGridPrefs.gridLayout]);

  const weekGridTemplateColumns = useMemo(() => {
    return `${buildNameColumnTrack(weekGridPrefs.nameColW)} repeat(7, ${buildDayColumnTrack(weekGridPrefs.cellMinW)})`;
  }, [weekGridPrefs.cellMinW, weekGridPrefs.nameColW]);

  const weekGridMinWidth = useMemo(() => {
    return Math.max(320, weekGridPrefs.nameColW + weekGridPrefs.cellMinW * 7);
  }, [weekGridPrefs.cellMinW, weekGridPrefs.nameColW]);

  const scheduleCellFontSize = 'var(--weekhub-cell-font-size, 12px)';
  const weekGridHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const weekGridBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const weekGridScrollSyncRef = useRef<0 | 1>(0);

  const syncWeekGridScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onWeekGridHeaderScroll = useCallback(() => {
    if (weekGridScrollSyncRef.current) return;
    weekGridScrollSyncRef.current = 1;
    syncWeekGridScrollLeft(weekGridHeaderScrollRef.current, weekGridBodyScrollRef.current);
    window.requestAnimationFrame(() => {
      weekGridScrollSyncRef.current = 0;
    });
  }, [syncWeekGridScrollLeft]);

  const onWeekGridBodyScroll = useCallback(() => {
    if (weekGridScrollSyncRef.current) return;
    weekGridScrollSyncRef.current = 1;
    syncWeekGridScrollLeft(weekGridBodyScrollRef.current, weekGridHeaderScrollRef.current);
    window.requestAnimationFrame(() => {
      weekGridScrollSyncRef.current = 0;
    });
  }, [syncWeekGridScrollLeft]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const apply = () => {
      const next = Math.max(0, Math.round(toolbar.getBoundingClientRect().height));
      setToolbarHeight((prev) => (prev === next ? prev : next));
    };

    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(toolbar);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div ref={toolbarRef} className="sticky top-0 z-40 border-b border-zinc-200 bg-white px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold">{weekViewLabel}</h1>
            </div>
            <div className="flex items-center justify-end gap-2">
              <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
                <button
                  type="button"
                  onClick={() => handleTabChange('week', 'normal')}
                  className={`rounded-md border px-3 py-1.5 text-sm transition ${
                    activeTab === 'week' && scheduleKind === 'normal'
                      ? 'border-red-500 bg-white text-zinc-900 shadow-sm dark:border-red-400 dark:bg-black dark:text-zinc-50'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  週予定
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange('personal', 'normal')}
                  className={`rounded-md border px-3 py-1.5 text-sm transition ${
                    activeTab === 'personal' && scheduleKind === 'normal'
                      ? 'border-red-500 bg-white text-zinc-900 shadow-sm dark:border-red-400 dark:bg-black dark:text-zinc-50'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  個人
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange('week', 'daily')}
                  className={`rounded-md border px-3 py-1.5 text-sm transition ${
                    activeTab === 'week' && scheduleKind === 'daily'
                      ? 'border-red-500 bg-white text-zinc-900 shadow-sm dark:border-red-400 dark:bg-black dark:text-zinc-50'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  日常
                </button>
              </div>
              <button
                type="button"
                onClick={handleReload}
                disabled={isLoading}
                className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                aria-label="再読込"
              >
                {isLoading ? '更新中…' : '再読込'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={goPrevMonth}
              className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-black"
              aria-label="前の月"
            >
              ←
            </button>
            <div className="flex min-w-max items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
              {monthWeekTabs.map((tab) => {
                const label = `${tab.getMonth() + 1}/${tab.getDate()}`;
                const active = toYmd(startOfWeekMonday(tab)) === toYmd(weekStart);
                return (
                  <button
                    key={toYmd(tab)}
                    type="button"
                    data-week-switch-tab="true"
                    onClick={() => setWeekStartByDate(tab)}
                    aria-current={active ? 'true' : undefined}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      active
                        ? 'border-red-500 bg-red-100 font-semibold text-red-700 shadow-sm dark:border-red-500 dark:bg-red-900/40 dark:text-red-300'
                        : 'border-transparent text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={goNextMonth}
              className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-black"
              aria-label="次の月"
            >
              →
            </button>
          </div>

          <div className="text-right text-sm text-zinc-500 dark:text-zinc-400">
            <div>{rangeLabel}</div>
          </div>

          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {activeTab === 'personal'
              ? `表示対象: ${userLabel(currentUser ?? authUser)}`
              : `表示対象: ${scheduleKind === 'daily' ? '日常予定（全従業員）' : '全従業員'}`}
          </div>

        </div>
      </div>

      <div className="p-4">
        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {activeTab === 'week' ? (
          <>
            <h2 className="mb-4 text-base font-medium">{weekViewLabel}</h2>

            {isLoading ? (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
                読み込み中...
              </div>
            ) : !schedule || orderedUsers.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
                表示できる従業員予定がありません。
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black">
                <div
                  className="sticky z-20 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
                  style={{ top: `${toolbarHeight}px` }}
                >
                  <div
                    ref={weekGridHeaderScrollRef}
                    className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
                    onScroll={onWeekGridHeaderScroll}
                    data-testid="mobile-week-grid-header-scroll"
                  >
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: weekGridTemplateColumns, minWidth: `${weekGridMinWidth}px` }}
                    >
                      <div
                        className="sticky left-0 z-10 border-r border-zinc-200 bg-white px-3 py-3 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-black dark:text-zinc-400"
                        style={{ minHeight: `${weekGridCellMinH}px` }}
                      >
                        従業員
                      </div>
                      {dayLabels.map((day) => (
                        <div
                          key={`header:${day.key}`}
                          className={`border-l border-zinc-200 bg-white px-2 py-3 text-center text-xs dark:border-zinc-800 dark:bg-black ${
                            day.isSun
                              ? 'text-red-600 dark:text-red-400'
                              : day.isSat
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                          style={{ minHeight: `${weekGridCellMinH}px` }}
                        >
                          <div>{day.dow}</div>
                          <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{day.dayNum}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div
                  ref={weekGridBodyScrollRef}
                  className="overflow-x-auto"
                  onScroll={onWeekGridBodyScroll}
                  data-testid="mobile-week-grid-body-scroll"
                >
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: weekGridTemplateColumns, minWidth: `${weekGridMinWidth}px` }}
                  >
                    {orderedUsers.map((user) => {
                      const isCurrentUser = user.id === authUser?.id;
                      return (
                        <Fragment key={user.id}>
                          <div
                            className={`sticky left-0 z-10 border-b border-r border-zinc-200 px-3 py-3 text-sm font-medium dark:border-zinc-800 ${
                              isCurrentUser ? 'bg-blue-50 dark:bg-blue-950/20' : 'bg-white dark:bg-black'
                            }`}
                            style={{ minHeight: `${weekGridCellMinH}px` }}
                          >
                            {userLabel(user)}
                          </div>
                          {dayLabels.map((day) => {
                            const groups = cellGroups(schedule.grid?.[user.id]?.[day.key]);
                            const personalScheduleDay = personalScheduleSummaryByUser[user.id]?.[day.key] ?? null;
                            return (
                              <div
                                key={`${user.id}:${day.key}`}
                                className={`relative border-b border-l border-zinc-200 px-2 py-2 text-xs dark:border-zinc-800 ${
                                  isCurrentUser ? 'bg-blue-50/60 dark:bg-blue-950/10' : ''
                                }`}
                                style={{ minHeight: `${weekGridCellMinH}px` }}
                              >
                                {groups.length > 0 ? (
                                  <div className={`space-y-1 ${personalScheduleDay?.count ? 'pb-4' : ''}`}>
                                    {groups.map((group, groupIndex) => {
                                      const displayEntry = groupDisplayEntry(group);
                                      if (!displayEntry) return null;
                                      const entryTargets = resolveScheduleGroupTargets(group, siteLookupByScheduleEntry);
                                      const previewLabel = resolveScheduleEntryPreview([displayEntry], siteLookupByScheduleEntry);
                                      const hasMultipleEntries = group.items.filter(
                                        (entry) => normalizeScheduleCellEntryKind(entry.kind) === 'site',
                                      ).length > 1;

                                      return (
                                        <button
                                          key={`${user.id}:${day.key}:${groupIndex}:${displayEntry.entry}`}
                                          type="button"
                                          onClick={(event) =>
                                            openCellEntryMenu(
                                              event,
                                              `${userLabel(user)} / ${day.key}`,
                                              entryTargets,
                                            )
                                          }
                                          className={`relative w-full rounded border px-2 py-1 text-left leading-snug ${
                                            entryTargets.some(isLinkedScheduleEntryTarget)
                                              ? 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900'
                                              : 'border-dashed border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'
                                          }`}
                                          style={{ fontSize: scheduleCellFontSize }}
                                          title="内容を確認"
                                          aria-haspopup="menu"
                                          aria-expanded={cellEntryMenu?.title === `${userLabel(user)} / ${day.key}` ? 'true' : undefined}
                                          data-testid={`mobile-week-cell-menu-${user.id}-${day.key}-${groupIndex}`}
                                        >
                                          <span
                                            className="block overflow-hidden whitespace-nowrap leading-tight"
                                            style={hasMultipleEntries ? { maxWidth: 'calc(100% - 0.8rem)' } : undefined}
                                          >
                                            {renderScheduleEntryLabel(previewLabel.entry, previewLabel.color)}
                                          </span>
                                          {hasMultipleEntries ? (
                                            <span className="absolute bottom-1 right-1 text-[10px] font-bold leading-none text-red-600 dark:text-red-400">
                                              +
                                            </span>
                                          ) : null}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="text-zinc-300 dark:text-zinc-700">-</div>
                                )}
                                {personalScheduleDay && personalScheduleDay.count > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(event) => openPersonalScheduleMenu(event, `${userLabel(user)} / ${day.key}`, day.key, personalScheduleDay)}
                                    className="absolute bottom-1 right-1 z-10 flex items-center gap-0.5 rounded px-0 py-0 text-[9px] font-semibold leading-none text-emerald-600 drop-shadow-[0_1px_2px_rgba(0,0,0,0.28)] transition hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                                    aria-label={`${day.key} の個人スケジュール ${personalScheduleDay.count}件`}
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_1.5px_rgba(255,255,255,0.95)] dark:shadow-[0_0_0_1.5px_rgba(9,9,11,0.95)]"
                                    />
                                    <span className="tabular-nums">{personalScheduleDay.count}</span>
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <h2 className="mb-4 text-base font-medium">今週の予定</h2>

            {isLoading ? (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
                読み込み中...
              </div>
            ) : !currentUser ? (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
                ログイン中ユーザーの予定を表示できません。
              </div>
            ) : (
              <div className="space-y-3">
                {dayLabels.map((day) => {
                  const entries = cellEntries(currentUserGrid[day.key]);
                  return (
                    <div
                      key={day.key}
                      className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-zinc-500 dark:text-zinc-400">{day.key}</div>
                          <div className="font-medium">
                            {day.dow} {day.dayNum}日
                          </div>
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {entries.length > 0 ? `${entries.length}件` : '予定なし'}
                        </div>
                      </div>

                      {entries.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {entries.map((entry) => (
                            <button
                              key={`${day.key}:${entry.entry}`}
                              type="button"
                              onClick={() => handleScheduleEntryClick(entry.entry)}
                              className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                              style={{ fontSize: scheduleCellFontSize }}
                              title="現場詳細を開く"
                            >
                              {renderScheduleEntryLabel(entry.entry, entry.color)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">この日の予定はありません。</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <h2 className="mb-4 mt-8 text-base font-medium">今週の現場リスト</h2>

            {assignedSites.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 dark:text-zinc-400">今週の割当現場はありません</div>
            ) : (
              <div className="space-y-3">
                {assignedSites.map((site) =>
                  site.id ? (
                    <button
                      key={`${site.id}:${site.label}`}
                      onClick={() => handleSiteClick(site.id!)}
                      className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      <div className={`font-medium ${labelTextClass(site.color)}`}>{site.label}</div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">タップして打刻・詳細を表示</div>
                    </button>
                  ) : (
                    <div
                      key={site.label}
                      className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm dark:border-zinc-800 dark:bg-black"
                    >
                      <div className={`font-medium ${labelTextClass(site.color)}`}>{site.label}</div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">台帳未紐付けの予定名です</div>
                    </div>
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>

      {cellEntryMenu ? (
        <>
          <button
            type="button"
            aria-label="現場一覧を閉じる"
            onClick={closeCellEntryMenu}
            className="fixed inset-0 z-40 bg-black/20"
          />
          <div
            className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-black"
            style={{ top: cellEntryMenu.top, left: cellEntryMenu.left, width: cellEntryMenu.width }}
            data-testid="mobile-cell-entry-menu"
          >
            <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{cellEntryMenu.title}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">現場を選択</div>
            </div>

            <div className="overflow-y-auto p-1" style={{ maxHeight: 'min(50vh, 22rem)' }}>
              {cellEntryMenu.items.map((item) => (
                <button
                  key={`${cellEntryMenu.title}:${item.siteId}`}
                  type="button"
                  onClick={() => {
                    if (!item.siteId) return;
                    closeCellEntryMenu();
                    handleSiteClick(item.siteId);
                  }}
                  disabled={!item.siteId}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-50 disabled:cursor-default disabled:text-zinc-500 dark:hover:bg-zinc-900 dark:disabled:text-zinc-400"
                  data-testid={`mobile-cell-entry-option-${item.siteId ?? 'unmapped'}`}
                >
                  <span className="truncate">{renderScheduleEntryLabel(item.entry, item.color)}</span>
                  <span className="ml-3 shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                    {item.noteOnly ? '追記' : item.siteId ? '詳細へ' : '未紐付け'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {personalScheduleMenu ? (
        <>
          <button
            type="button"
            aria-label="個人スケジュール一覧を閉じる"
            onClick={closePersonalScheduleMenu}
            className="fixed inset-0 z-40 bg-black/20"
          />
          <div
            className="fixed z-50 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-2xl dark:border-emerald-900/60 dark:bg-zinc-950"
            style={{ top: personalScheduleMenu.top, left: personalScheduleMenu.left, width: personalScheduleMenu.width }}
            data-testid="mobile-personal-schedule-menu"
          >
            <div className="border-b border-emerald-100 px-3 py-2 dark:border-emerald-900/50">
              <div className="truncate text-[11px] font-medium text-emerald-700 dark:text-emerald-300">{personalScheduleMenu.title}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                {personalScheduleMenu.dayYmd} / スケジュール {personalScheduleMenu.count}件
              </div>
            </div>

            <div className="overflow-y-auto p-1" style={{ maxHeight: 'min(50vh, 22rem)' }}>
              {personalScheduleMenu.items.map((item) => (
                <div
                  key={`${personalScheduleMenu.dayYmd}:${item.id}`}
                  className="rounded-lg px-3 py-2 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/20"
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${personalScheduleSwatchClass(item.color)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">{item.slotIndex + 1}</span>
                        <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{item.title}</span>
                      </div>
                      {item.note ? (
                        <div className="mt-0.5 break-words text-[11px] text-zinc-500 dark:text-zinc-400">{item.note}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}