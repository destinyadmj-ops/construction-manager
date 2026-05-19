'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  mergeUserCandidates,
  readCachedUserCandidates,
  USER_CANDIDATES_UPDATED_EVENT,
  writeCachedUserCandidates,
  type CachedUserCandidate,
} from './user-candidate-cache';

type UserKind = 'NORMAL' | 'DAILY';

type ApiUser = CachedUserCandidate;

type LoginMemory = {
  userId: string;
  userKind: UserKind | null;
  deviceKey: string;
  host: string;
  platform: string;
  language: string;
  timeZone: string;
  savedAt: string;
};

type MeResponse =
  | {
      ok: true;
      user:
        | { id: string; name: string | null; email: string | null; kind: UserKind; passwordConfigured?: boolean | null }
        | null;
    }
  | { ok: false; error: string };

type ExistingLoginMode = 'select' | 'password' | 'setup';
type GateScreen = 'home' | 'existing-auth';

const LOGIN_MEMORY_KEY = 'masterHub.loginMemory.v1';
const DEVICE_KEY_STORAGE_KEY = 'masterHub.deviceKey.v1';

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function getString(o: Record<string, unknown> | null, key: string): string | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

function getCurrentKind(input: string | null): UserKind {
  return (input ?? '').trim().toLowerCase() === 'daily' ? 'DAILY' : 'NORMAL';
}

function createDeviceKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateDeviceKey() {
  try {
    const existing = (window.localStorage.getItem(DEVICE_KEY_STORAGE_KEY) ?? '').trim();
    if (existing) return existing;
    const next = createDeviceKey();
    window.localStorage.setItem(DEVICE_KEY_STORAGE_KEY, next);
    return next;
  } catch {
    return createDeviceKey();
  }
}

function getDeviceContext() {
  return {
    host: window.location.host,
    platform: (navigator.platform ?? '').trim(),
    language: (navigator.language ?? '').trim(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
  };
}

function readLoginMemory(): LoginMemory | null {
  try {
    const raw = window.localStorage.getItem(LOGIN_MEMORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const userId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
    const userKind = obj.userKind === 'DAILY' || obj.userKind === 'NORMAL' ? obj.userKind : null;
    const deviceKey = typeof obj.deviceKey === 'string' ? obj.deviceKey : '';
    const host = typeof obj.host === 'string' ? obj.host : '';
    const platform = typeof obj.platform === 'string' ? obj.platform : '';
    const language = typeof obj.language === 'string' ? obj.language : '';
    const timeZone = typeof obj.timeZone === 'string' ? obj.timeZone : '';
    const savedAt = typeof obj.savedAt === 'string' ? obj.savedAt : '';
    if (!userId || !host || !deviceKey) return null;
    return { userId, userKind, deviceKey, host, platform, language, timeZone, savedAt };
  } catch {
    return null;
  }
}

function writeLoginMemory(userId: string, userKind: UserKind | null) {
  try {
    const ctx = getDeviceContext();
    const payload: LoginMemory = {
      userId,
      userKind,
      deviceKey: getOrCreateDeviceKey(),
      host: ctx.host,
      platform: ctx.platform,
      language: ctx.language,
      timeZone: ctx.timeZone,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(LOGIN_MEMORY_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function clearLoginMemory() {
  try {
    window.localStorage.removeItem(LOGIN_MEMORY_KEY);
  } catch {
    // ignore
  }
}

function isSameDevice(memory: LoginMemory | null): memory is LoginMemory {
  if (!memory) return false;
  const ctx = getDeviceContext();
  return (
    memory.host === ctx.host &&
    memory.platform === ctx.platform &&
    memory.language === ctx.language &&
    memory.timeZone === ctx.timeZone
  );
}

function readDomUserCandidates(defaultKind: UserKind): ApiUser[] {
  if (typeof document === 'undefined') return [];

  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-user-row]'));
  const candidates: ApiUser[] = [];

  for (const row of rows) {
    const id = (row.dataset.userRow ?? '').trim();
    if (!id) continue;

    const label =
      (row.querySelector<HTMLElement>('[data-user-label]')?.textContent ?? row.dataset.userLabel ?? '').trim();
    const kind = row.dataset.userKind === 'DAILY' ? 'DAILY' : row.dataset.userKind === 'NORMAL' ? 'NORMAL' : defaultKind;

    candidates.push({
      id,
      name: label || null,
      email: null,
      kind,
      passwordConfigured: null,
    });
  }

  return mergeUserCandidates(candidates, []);
}

function candidateLabel(user: ApiUser) {
  return (user.name ?? user.email ?? user.id).trim();
}

function sortUserCandidates(candidates: ApiUser[], rememberedUserId: string | null, currentKind: UserKind) {
  const orderIndex = new Map(candidates.map((candidate, index) => [candidate.id, index] as const));

  return [...candidates].sort((a, b) => {
    const aRemembered = rememberedUserId === a.id ? 1 : 0;
    const bRemembered = rememberedUserId === b.id ? 1 : 0;
    if (aRemembered !== bRemembered) return bRemembered - aRemembered;

    const aKind = a.kind === currentKind ? 1 : 0;
    const bKind = b.kind === currentKind ? 1 : 0;
    if (aKind !== bKind) return bKind - aKind;

    const aOrder = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return candidateLabel(a).localeCompare(candidateLabel(b), 'ja');
  });
}

export default function UserGate({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ id: string; name: string | null; email: string | null } | null>(null);
  const [open, setOpen] = useState(false);

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [candidateRevision, setCandidateRevision] = useState(0);

  const [selectedExistingId, setSelectedExistingId] = useState<string>('');
  const [screen, setScreen] = useState<GateScreen>('home');
  const [existingLoginMode, setExistingLoginMode] = useState<ExistingLoginMode>('select');
  const [existingPassword, setExistingPassword] = useState('');
  const [newExistingPassword, setNewExistingPassword] = useState('');
  const [newExistingPasswordConfirm, setNewExistingPasswordConfirm] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userPasswordConfirm, setUserPasswordConfirm] = useState('');
  const [registerShowInSchedule, setRegisterShowInSchedule] = useState(true);
  const [isMobileBrowser, setIsMobileBrowser] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const didInitRef = useRef(false);

  const currentKind = useMemo<UserKind>(() => getCurrentKind(searchParams.get('kind')), [searchParams]);

  const title = useMemo(() => {
    if (me?.name?.trim()) return me.name.trim();
    if (me?.email?.trim()) return me.email.trim();
    return me?.id ?? null;
  }, [me]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('masterHub:openUserGate', onOpen as EventListener);
    return () => window.removeEventListener('masterHub:openUserGate', onOpen as EventListener);
  }, []);

  useEffect(() => {
    const onUpdated = () => setCandidateRevision((current) => current + 1);
    window.addEventListener(USER_CANDIDATES_UPDATED_EVENT, onUpdated as EventListener);
    return () => window.removeEventListener(USER_CANDIDATES_UPDATED_EVENT, onUpdated as EventListener);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const userAgent = navigator.userAgent;
    const isWorkbenchShell = /\bCode\/\d+/i.test(userAgent);
    const isElectronShell = /\bElectron\/\d+/i.test(userAgent) && !isWorkbenchShell;
    const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    setIsMobileBrowser(mobile && !isElectronShell);
  }, []);

  useEffect(() => {
    setScreen('home');
    setExistingLoginMode('select');
    setExistingPassword('');
    setNewExistingPassword('');
    setNewExistingPasswordConfirm('');
    setRegisterShowInSchedule(true);
  }, [open, selectedExistingId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restoreRememberedUser = async () => {
        const memory = readLoginMemory();
        if (!isSameDevice(memory)) {
          clearLoginMemory();
          return false;
        }

        try {
          const restore = await fetch('/api/auth/me', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              userId: memory.userId,
              restore: true,
              device: {
                deviceKey: memory.deviceKey,
                host: memory.host,
                platform: memory.platform,
                language: memory.language,
                timeZone: memory.timeZone,
              },
            }),
          });
          const restoredJson = (await restore.json().catch(() => null)) as unknown;
          const restoredObj = asObject(restoredJson);
          if (!restore.ok || restoredObj?.ok !== true) return false;

          const meRes = await fetch('/api/auth/me');
          const meJson = (await meRes.json().catch(() => null)) as MeResponse;
          if (!meRes.ok || meJson.ok !== true || !meJson.user) return false;

          if (cancelled) return true;
          setMe({ id: meJson.user.id, name: meJson.user.name, email: meJson.user.email });
          writeLoginMemory(meJson.user.id, meJson.user.kind);
          setOpen(false);
          return true;
        } catch {
          return false;
        }
      };

      try {
        const r = await fetch('/api/auth/me');
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        if (!r.ok || obj?.ok !== true) {
          if (cancelled) return;
          const restored = await restoreRememberedUser();
          if (!restored) {
            setMe(null);
            setOpen(true);
          }
          return;
        }

        const userObj = asObject(obj.user);
        const id = getString(userObj, 'id');
        const nameVal = getString(userObj, 'name');
        const emailVal = getString(userObj, 'email');
        const kindVal = getString(userObj, 'kind');

        if (cancelled) return;
        if (id) {
          setMe({ id, name: nameVal, email: emailVal });
          writeLoginMemory(id, kindVal === 'DAILY' ? 'DAILY' : 'NORMAL');
          setOpen(false);
        } else {
          const restored = await restoreRememberedUser();
          if (!restored) {
            setMe(null);
            setOpen(true);
          }
        }
      } catch {
        if (cancelled) return;
        const restored = await restoreRememberedUser();
        if (!restored) {
          setMe(null);
          setOpen(true);
        }
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setUsersLoading(true);
    void (async () => {
      try {
        const remembered = readLoginMemory();
        const cached = readCachedUserCandidates();
        const domCandidates = readDomUserCandidates(currentKind);
        const localCandidates = mergeUserCandidates(domCandidates, cached);

        if (localCandidates.length > 0) {
          const sortedLocal = sortUserCandidates(localCandidates, remembered?.userId ?? null, currentKind);
          if (cancelled) return;
          setUsers(sortedLocal);
          if (!didInitRef.current) {
            didInitRef.current = true;
            setSelectedExistingId(remembered?.userId ?? sortedLocal[0]?.id ?? '');
          } else if (sortedLocal.length > 0) {
            setSelectedExistingId((current) => current || remembered?.userId || sortedLocal[0]!.id);
          }
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 350));

        const delayedLocalCandidates = mergeUserCandidates(readDomUserCandidates(currentKind), readCachedUserCandidates());
        if (delayedLocalCandidates.length > 0) {
          const sortedDelayedLocal = sortUserCandidates(delayedLocalCandidates, remembered?.userId ?? null, currentKind);
          if (cancelled) return;
          setUsers(sortedDelayedLocal);
          if (!didInitRef.current) {
            didInitRef.current = true;
            setSelectedExistingId(remembered?.userId ?? sortedDelayedLocal[0]?.id ?? '');
          } else if (sortedDelayedLocal.length > 0) {
            setSelectedExistingId((current) => current || remembered?.userId || sortedDelayedLocal[0]!.id);
          }
          return;
        }

        const r = await fetch('/api/users?kind=all', { cache: 'no-store' });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        const arr = Array.isArray(obj?.users) ? (obj!.users as unknown[]) : [];
        const parsed: ApiUser[] = arr
          .map((x) => asObject(x))
          .map((o) => {
            const id = getString(o, 'id');
            if (!id) return null;
            const user: ApiUser = {
              id,
              name: getString(o, 'name'),
              email: getString(o, 'email'),
              kind: getString(o, 'kind') === 'DAILY' ? 'DAILY' : 'NORMAL',
              passwordConfigured: typeof o?.passwordConfigured === 'boolean' ? (o.passwordConfigured as boolean) : null,
            };
            return user;
          })
          .filter((x): x is ApiUser => !!x);

        const combined = mergeUserCandidates(mergeUserCandidates(domCandidates, cached), parsed);

        if (combined.length > 0) writeCachedUserCandidates(combined);

        const merged = sortUserCandidates(combined, remembered?.userId ?? null, currentKind);

        if (cancelled) return;
        setUsers(merged);
        if (!didInitRef.current) {
          didInitRef.current = true;
          setSelectedExistingId(remembered?.userId ?? merged[0]?.id ?? '');
        } else if (merged.length > 0) {
          setSelectedExistingId((current) => current || remembered?.userId || merged[0]!.id);
        }
      } catch {
        if (cancelled) return;
        const remembered = readLoginMemory();
        const fallbackCandidates = mergeUserCandidates(readDomUserCandidates(currentKind), readCachedUserCandidates());
        const sortedFallback = sortUserCandidates(fallbackCandidates, remembered?.userId ?? null, currentKind);
        setUsers(sortedFallback);
        if (sortedFallback.length > 0) {
          setSelectedExistingId((current) => current || remembered?.userId || sortedFallback[0]!.id);
        }
      } finally {
        if (cancelled) return;
        setUsersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [candidateRevision, currentKind, open]);

  const selectedExistingUser = (() => {
    const userId = selectedExistingId.trim();
    return userId ? users.find((user) => user.id === userId) ?? null : null;
  })();

  if (loading) return <>{children}</>;

  const closeIfPossible = () => {
    if (!me) return;
    setOpen(false);
  };

  const fetchUsersFromApi = async () => {
    const r = await fetch('/api/users?kind=all', { cache: 'no-store' });
    const j = (await r.json().catch(() => null)) as unknown;
    const obj = asObject(j);
    const arr = Array.isArray(obj?.users) ? (obj!.users as unknown[]) : [];
    const parsed: ApiUser[] = arr
      .map((x) => asObject(x))
      .map((o) => {
        const id = getString(o, 'id');
        if (!id) return null;
        const user: ApiUser = {
          id,
          name: getString(o, 'name'),
          email: getString(o, 'email'),
          kind: getString(o, 'kind') === 'DAILY' ? 'DAILY' : 'NORMAL',
          passwordConfigured: typeof o?.passwordConfigured === 'boolean' ? (o.passwordConfigured as boolean) : null,
        };
        return user;
      })
      .filter((x): x is ApiUser => !!x);

    if (parsed.length > 0) {
      writeCachedUserCandidates(mergeUserCandidates(users, parsed));
      setUsers((current) => sortUserCandidates(mergeUserCandidates(current, parsed), readLoginMemory()?.userId ?? null, currentKind));
    }

    return parsed;
  };

  const onContinueExisting = async () => {
    setError(null);
    const userId = selectedExistingId.trim();
    if (!userId) {
      setError('ユーザーを選択してください');
      return;
    }

    if (isMobileBrowser) {
      await onPickExisting();
      return;
    }

    let nextUser = selectedExistingUser;
    if (!nextUser || nextUser.passwordConfigured == null) {
      const fetched = await fetchUsersFromApi().catch(() => [] as ApiUser[]);
      nextUser = fetched.find((user) => user.id === userId) ?? nextUser;
    }

    setExistingLoginMode(nextUser?.passwordConfigured ? 'password' : 'setup');
    setScreen('existing-auth');
  };

  const onPickExisting = async () => {
    setError(null);
    const userId = selectedExistingId.trim();
    if (!userId) {
      setError('ユーザーを選択してください');
      return;
    }

    if (!isMobileBrowser && existingLoginMode === 'password' && !existingPassword.trim()) {
      setError('パスワードを入力してください');
      return;
    }

    if (!isMobileBrowser && existingLoginMode === 'setup') {
      if (!newExistingPassword.trim()) {
        setError('新しいパスワードを入力してください');
        return;
      }
      if (newExistingPassword !== newExistingPasswordConfirm) {
        setError('確認用パスワードが一致しません');
        return;
      }
    }

    try {
      const r = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...(!isMobileBrowser && existingLoginMode === 'password' ? { password: existingPassword } : {}),
          ...(!isMobileBrowser && existingLoginMode === 'setup' ? { newPassword: newExistingPassword } : {}),
          device: {
            deviceKey: getOrCreateDeviceKey(),
            ...getDeviceContext(),
          },
        }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) {
        const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
        const code = typeof obj?.code === 'string' ? obj.code : null;
        if (!isMobileBrowser && code === 'PASSWORD_SETUP_REQUIRED') {
          setExistingLoginMode('setup');
          setScreen('existing-auth');
          setError(msg);
          return;
        }
        if (!isMobileBrowser && code === 'INVALID_PASSWORD') {
          setExistingLoginMode('password');
          setScreen('existing-auth');
          setError(msg);
          return;
        }
        setError(msg);
        return;
      }

      // Re-read current user
      const r2 = await fetch('/api/auth/me');
      const j2 = (await r2.json().catch(() => null)) as MeResponse;
      if (!r2.ok || j2.ok !== true || !j2.user) {
        setError('ログインに失敗しました');
        return;
      }

      setMe({ id: j2.user.id, name: j2.user.name, email: j2.user.email });
      writeLoginMemory(j2.user.id, j2.user.kind);
      writeCachedUserCandidates([
        ...users,
        {
          id: j2.user.id,
          name: j2.user.name,
          email: j2.user.email,
          kind: j2.user.kind,
          passwordConfigured: j2.user.passwordConfigured,
        },
      ]);
      setExistingLoginMode('select');
      setScreen('home');
      setExistingPassword('');
      setNewExistingPassword('');
      setNewExistingPasswordConfirm('');
      setOpen(false);
      window.location.reload();
    } catch {
      setError('通信に失敗しました');
    }
  };

  const onRegister = async () => {
    setError(null);

    const n = name.trim();
    if (!n) {
      setError('名前を入力してください');
      return;
    }

    if (!isMobileBrowser) {
      if (!userPassword.trim()) {
        setError('個人パスワードを入力してください');
        return;
      }
      if (userPassword !== userPasswordConfirm) {
        setError('個人パスワード（確認）が一致しません');
        return;
      }
    }

    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: n,
          email: email.trim() || null,
          kind: currentKind,
          showInSchedule: isMobileBrowser ? true : registerShowInSchedule,
          registrationPassword: registrationPassword.trim() || null,
          userPassword: !isMobileBrowser ? userPassword : null,
          device: {
            deviceKey: getOrCreateDeviceKey(),
            ...getDeviceContext(),
          },
        }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) {
        const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
        setError(msg);
        return;
      }

      const userId = typeof obj?.userId === 'string' ? obj.userId : '';
      if (userId) {
        writeLoginMemory(userId, currentKind);
        writeCachedUserCandidates([
          ...users,
          { id: userId, name: n, email: email.trim() || null, kind: currentKind, passwordConfigured: !isMobileBrowser },
        ]);
      }
      window.location.reload();
    } catch {
      setError('通信に失敗しました');
    }
  };

  return (
    <>
      <div className="min-h-screen">
        {children}
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            closeIfPossible();
          }}
        >
          <div
            data-color-edit-id="user-gate:modal"
            data-color-edit-slot="border"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">初回ログイン / ユーザー選択</div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  名前を登録すると「自分の予定表示」などに使えます。
                </div>
              </div>
              {me ? (
                <button
                  type="button"
                  data-color-edit-id="user-gate:close"
                  onClick={closeIfPossible}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  閉じる
                </button>
              ) : null}
            </div>

            {me ? (
              <div
                data-color-edit-id="user-gate:current-user"
                data-color-edit-slot="border"
                className="mt-3 rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200"
              >
                現在: {title ?? '（未設定）'}
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">既存ユーザーから選ぶ</div>
              {screen === 'home' ? (
                <>
                  <div className="mt-2 flex gap-2">
                    <select
                      value={selectedExistingId}
                      onChange={(e) => setSelectedExistingId(e.target.value)}
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    >
                      {users.length === 0 ? <option value="">（ユーザーなし）</option> : null}
                      {users.map((u) => {
                        const label = (u.name ?? u.email ?? u.id).trim();
                        return (
                          <option key={u.id} value={u.id}>
                            {label} {u.kind === 'DAILY' ? '［日報］' : '［通常］'}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      onClick={() => void onContinueExisting()}
                      disabled={usersLoading}
                      className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      {isMobileBrowser ? '切替' : '次へ'}
                    </button>
                  </div>
                  {usersLoading ? <div className="mt-1 text-[11px] text-zinc-500">読み込み中…</div> : null}
                  {!usersLoading && users.length > 0 ? (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      現在表示中の予定種別（{currentKind === 'DAILY' ? '日報' : '通常'}）に近いユーザーを先頭に表示しています。
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-2 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-[11px] dark:border-zinc-800 dark:bg-zinc-950/60">
                  <div className="text-zinc-600 dark:text-zinc-300">選択中: {selectedExistingUser ? candidateLabel(selectedExistingUser) : '（未選択）'}</div>
                  {existingLoginMode === 'password' ? (
                    <>
                      <div className="text-zinc-600 dark:text-zinc-300">このアカウントは個人パスワード入力でログインします。</div>
                      <input
                        type="password"
                        value={existingPassword}
                        onChange={(e) => setExistingPassword(e.target.value)}
                        placeholder="個人パスワード"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                    </>
                  ) : (
                    <>
                      <div className="text-zinc-600 dark:text-zinc-300">
                        初回ログインのため、次の画面でこのPC用の個人パスワードを設定します。
                      </div>
                      <input
                        type="password"
                        value={newExistingPassword}
                        onChange={(e) => setNewExistingPassword(e.target.value)}
                        placeholder="新しい個人パスワード"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <input
                        type="password"
                        value={newExistingPasswordConfirm}
                        onChange={(e) => setNewExistingPasswordConfirm(e.target.value)}
                        placeholder="新しい個人パスワード（確認）"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                    </>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setScreen('home');
                        setExistingLoginMode('select');
                      }}
                      className="w-full rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      戻る
                    </button>
                    <button
                      type="button"
                      onClick={() => void onPickExisting()}
                      className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      {existingLoginMode === 'password' ? 'ログイン' : '設定してログイン'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">新規ユーザー登録</div>
              <div className="mt-2 space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="名前（必須）"
                  className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="メール（任意）"
                  className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                />
                <input
                  value={registrationPassword}
                  onChange={(e) => setRegistrationPassword(e.target.value)}
                  placeholder="登録パスワード（任意 / 設定時のみ必要）"
                  className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                />
                {!isMobileBrowser ? (
                  <>
                    <label className="flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={registerShowInSchedule}
                        onChange={(e) => setRegisterShowInSchedule(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-black"
                      />
                      <span>
                        新規登録後、この名前を{currentKind === 'DAILY' ? '日報' : '週予定'}の一覧に追加する
                      </span>
                    </label>
                    <input
                      type="password"
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                      placeholder="個人パスワード（8文字以上）"
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                    <input
                      type="password"
                      value={userPasswordConfirm}
                      onChange={(e) => setUserPasswordConfirm(e.target.value)}
                      placeholder="個人パスワード（確認）"
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={() => void onRegister()}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                >
                  登録して開始
                </button>
              </div>
            </div>

            {error ? <div className="mt-3 text-xs text-red-700 dark:text-red-300">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
