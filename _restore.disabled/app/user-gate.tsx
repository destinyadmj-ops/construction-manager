'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type ApiUser = { id: string; name: string | null; email: string | null };

type MeResponse =
  | { ok: true; user: { id: string; name: string | null; email: string | null; kind: 'NORMAL' | 'DAILY' } | null }
  | { ok: false; error: string };

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function getString(o: Record<string, unknown> | null, key: string): string | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

export default function UserGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ id: string; name: string | null; email: string | null } | null>(null);
  const [open, setOpen] = useState(false);

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const [selectedExistingId, setSelectedExistingId] = useState<string>('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');

  const [error, setError] = useState<string | null>(null);

  const didInitRef = useRef(false);

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
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/auth/me');
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        if (!r.ok || obj?.ok !== true) {
          if (cancelled) return;
          setMe(null);
          setOpen(true);
          return;
        }

        const userObj = asObject(obj.user);
        const id = getString(userObj, 'id');
        const nameVal = getString(userObj, 'name');
        const emailVal = getString(userObj, 'email');

        if (cancelled) return;
        if (id) {
          setMe({ id, name: nameVal, email: emailVal });
          setOpen(false);
        } else {
          setMe(null);
          setOpen(true);
        }
      } catch {
        if (cancelled) return;
        setMe(null);
        setOpen(true);
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
    if (usersLoading) return;

    let cancelled = false;
    setUsersLoading(true);
    void (async () => {
      try {
        const r = await fetch('/api/users?kind=normal');
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        const arr = Array.isArray(obj?.users) ? (obj!.users as unknown[]) : [];
        const parsed: ApiUser[] = arr
          .map((x) => asObject(x))
          .map((o) => {
            const id = getString(o, 'id');
            if (!id) return null;
            return {
              id,
              name: getString(o, 'name'),
              email: getString(o, 'email'),
            } satisfies ApiUser;
          })
          .filter((x): x is ApiUser => !!x);

        if (cancelled) return;
        setUsers(parsed);
        if (!didInitRef.current) {
          didInitRef.current = true;
          setSelectedExistingId(parsed[0]?.id ?? '');
        }
      } catch {
        if (cancelled) return;
        setUsers([]);
      } finally {
        if (cancelled) return;
        setUsersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, usersLoading]);

  if (loading) return <>{children}</>;

  const closeIfPossible = () => {
    if (!me) return;
    setOpen(false);
  };

  const onPickExisting = async () => {
    setError(null);
    const userId = selectedExistingId.trim();
    if (!userId) {
      setError('ユーザーを選択してください');
      return;
    }

    try {
      const r = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) {
        const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
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

    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: n,
          email: email.trim() || null,
          kind: 'NORMAL',
          registrationPassword: registrationPassword.trim() || null,
        }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) {
        const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
        setError(msg);
        return;
      }

      window.location.reload();
    } catch {
      setError('通信に失敗しました');
    }
  };

  return (
    <>
      <div
        className="min-h-screen"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          try {
            if (pathname === '/') {
              window.scrollTo({ top: 0, left: 0 });
              return;
            }
            router.push('/?mode=week');
          } catch {
            // ignore
          }
        }}
      >
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
                  onClick={closeIfPossible}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  閉じる
                </button>
              ) : null}
            </div>

            {me ? (
              <div
                data-color-edit-slot="border"
                className="mt-3 rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200"
              >
                現在: {title ?? '（未設定）'}
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">既存ユーザーから選ぶ</div>
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
                        {label}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  onClick={() => void onPickExisting()}
                  disabled={usersLoading}
                  className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                >
                  切替
                </button>
              </div>
              {usersLoading ? <div className="mt-1 text-[11px] text-zinc-500">読み込み中…</div> : null}
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
