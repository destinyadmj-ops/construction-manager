import { test, expect } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import net from 'node:net';
import { PrismaClient } from '../src/generated/prisma';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

type PrismaClientOptions = ConstructorParameters<typeof PrismaClient>[0];

let dbAvailable = false;

function getPgAdapterConfig(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const sslMode = (url.searchParams.get('sslmode') ?? '').toLowerCase();
    const shouldUseSupabaseSsl =
      sslMode === 'require' ||
      url.hostname.endsWith('.supabase.co') ||
      url.hostname.endsWith('.pooler.supabase.com');

    if (!shouldUseSupabaseSsl) {
      return { connectionString };
    }

    url.searchParams.delete('sslmode');
    return {
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: false,
      },
    };
  } catch {
    return { connectionString };
  }
}

function getPrismaClientOptions(): PrismaClientOptions {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  return {
    adapter: new PrismaPg(getPgAdapterConfig(connectionString)),
  };
}

const prisma = new PrismaClient(getPrismaClientOptions());

function getDbHostPortFromEnv(): { host: string; port: number } {
  const url = process.env.DATABASE_URL;
  if (!url) return { host: '127.0.0.1', port: 5432 };
  try {
    const u = new URL(url);
    const host = u.hostname || '127.0.0.1';
    const port = u.port ? Number(u.port) : 5432;
    return { host, port: Number.isFinite(port) ? port : 5432 };
  } catch {
    return { host: '127.0.0.1', port: 5432 };
  }
}

async function canConnectTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

test.beforeAll(async () => {
  const { host, port } = getDbHostPortFromEnv();
  dbAvailable = await canConnectTcp(host, port, 500);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

function getAdminHeaders() {
  const token = process.env.ADMIN_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers['x-admin-token'] = token;
  return headers;
}

async function loginAs(page: import('@playwright/test').Page, userId: string) {
  const res = await page.request.post('/api/auth/me', {
    headers: { 'content-type': 'application/json' },
    data: { userId },
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function ensureEditModeEnabled(page: import('@playwright/test').Page) {
  const status = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/auth/edit-mode');
      const j = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, json: j };
    } catch {
      return { ok: false, status: 0, json: null };
    }
  });

  if (!status.ok || !status.json || typeof status.json !== 'object') {
    throw new Error(`E2E: /api/auth/edit-mode failed (HTTP ${status.status})`);
  }

  const statusJson = status.json as Record<string, unknown>;
  if (statusJson.ok !== true) {
    throw new Error(`E2E: /api/auth/edit-mode failed (HTTP ${status.status})`);
  }

  const configured = statusJson.configured === true;
  const enabled = statusJson.enabled === true;
  if (enabled) return { configured, enabled: true } as const;
  if (!configured) return { configured: false, enabled: false } as const;

  const password = (process.env.MASTER_HUB_EDIT_PASSWORD ?? '').trim();
  if (!password) return { configured: true, enabled: false, needsPassword: true } as const;

  const post = await page.evaluate(async (pw) => {
    try {
      const r = await fetch('/api/auth/edit-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const j = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, json: j };
    } catch {
      return { ok: false, status: 0, json: null };
    }
  }, password);

  if (!post.ok || !post.json || typeof post.json !== 'object') {
    throw new Error(`E2E: /api/auth/edit-mode POST failed (HTTP ${post.status})`);
  }

  const postJson = post.json as Record<string, unknown>;
  if (postJson.ok !== true) {
    throw new Error(`E2E: /api/auth/edit-mode POST failed (HTTP ${post.status})`);
  }

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  return { configured: true, enabled: true } as const;
}

async function enterWeekHubEditMode(page: import('@playwright/test').Page, userId: string) {
  const enabled = await ensureEditModeEnabled(page);
  if ('needsPassword' in enabled && enabled.needsPassword) {
    test.skip(true, 'Edit mode is configured; set MASTER_HUB_EDIT_PASSWORD for UI E2E');
  }

  const addButton = page.getByTestId('header-action-add');
  const saveButton = page.getByTestId('header-action-save');
  const settingsButton = page.getByRole('button', { name: '設定' });

  const addVisible = await addButton.isVisible().catch(() => false);
  const addEnabled = await addButton.isEnabled().catch(() => false);
  if (addVisible && addEnabled) {
    await addButton.click();
  } else if (addVisible) {
    const saveEnabled = await saveButton.isEnabled().catch(() => false);
    if (!saveEnabled) {
      await expect(addButton).toBeEnabled({ timeout: 15_000 });
      await addButton.click();
    }
  } else {
    await settingsButton.click();
    const scheduleEditButton = page.getByRole('button', { name: /編集開始|編集終了|編集準備中/ }).last();
    await expect(scheduleEditButton).toBeVisible({ timeout: 15_000 });

    const label = (await scheduleEditButton.textContent()) ?? '';
    if (label.includes('編集開始')) {
      await scheduleEditButton.click();
    }

    await expect(scheduleEditButton).toHaveText(/編集終了/, { timeout: 15_000 });
    await settingsButton.click();
  }

  if (addVisible) {
    await expect(saveButton).toBeEnabled({ timeout: 15_000 });
  }

  const anyCell = page.locator(`[data-testid^="cell-${userId}-"]`).first();
  await expect(anyCell).toBeVisible({ timeout: 15_000 });
}

async function dndWithData(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
  data: Record<string, string>,
) {
  const dt = await page.evaluateHandle((payload) => {
    const d = new DataTransfer();
    for (const [k, v] of Object.entries(payload)) d.setData(k, v);
    return d;
  }, data);

  await source.dispatchEvent('dragstart', { dataTransfer: dt });
  await target.dispatchEvent('dragenter', { dataTransfer: dt });
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await source.dispatchEvent('dragend', { dataTransfer: dt });
}

async function ensureUserGateCleared(page: import('@playwright/test').Page) {
  const gateTitle = page.getByText('初回ログイン / ユーザー選択');
  const closeButton = page.getByRole('button', { name: '閉じる' });

  const isGateVisible = async () => {
    return await gateTitle
      .isVisible()
      .then((v) => v)
      .catch(() => false);
  };

  const closeGateIfPossible = async () => {
    const canClose = await closeButton
      .isVisible()
      .then((v) => v)
      .catch(() => false);

    if (!canClose) return false;

    await closeButton.click();
    await page.waitForTimeout(300);
    return !(await isGateVisible());
  };

  await page.waitForLoadState('networkidle').catch(() => {});

  for (let attempt = 0; attempt < 5; attempt++) {
    const visible = await isGateVisible();
    if (!visible) {
      await page.waitForTimeout(500);
      if (!(await isGateVisible())) return;
    }

    if (await closeGateIfPossible()) return;

    // E2EではUserGateが出たら、DBにユーザーを用意して /api/auth/me に直接POSTしてログイン状態を作る。
    const existing = await prisma.user.findFirst({ select: { id: true } });
    const user =
      existing ??
      (await prisma.user.create({
        data: {
          email: `e2e-gate-${Date.now()}@example.test`,
          name: 'E2E Gate User',
          canEditSchedule: true,
        },
        select: { id: true },
      }));

    const ok = await page.evaluate(async (userId) => {
      try {
        const r = await fetch('/api/auth/me', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const j = await r.json().catch(() => null);
        if (!j || typeof j !== 'object') return false;
        return (j as Record<string, unknown>).ok === true;
      } catch {
        return false;
      }
    }, user.id);

    if (!ok) {
      throw new Error('E2E: failed to set user via /api/auth/me');
    }

    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);
    if (await closeGateIfPossible()) return;
    if (!(await isGateVisible())) return;
  }

  throw new Error('E2E: UserGate could not be cleared');
}

async function closeVisibleUserGate(page: import('@playwright/test').Page) {
  const gateTitle = page.getByText('初回ログイン / ユーザー選択');
  const closeButton = page.getByRole('button', { name: '閉じる' });

  for (let attempt = 0; attempt < 6; attempt++) {
    const gateVisible = await gateTitle
      .isVisible()
      .then((v) => v)
      .catch(() => false);
    if (!gateVisible) return;

    const canClose = await closeButton
      .isVisible()
      .then((v) => v)
      .catch(() => false);
    if (!canClose) {
      await page.waitForTimeout(500);
      continue;
    }

    await closeButton.click();
    await page.waitForTimeout(300);
  }
}

async function openYearMode(page: import('@playwright/test').Page) {
  const yearButton = page.getByRole('button', { name: '年予定' });
  const gateTitle = page.getByText('初回ログイン / ユーザー選択');

  for (let attempt = 0; attempt < 6; attempt++) {
    await closeVisibleUserGate(page);
    const gateVisible = await gateTitle
      .isVisible()
      .then((v) => v)
      .catch(() => false);
    if (gateVisible) {
      await page.waitForTimeout(500);
      continue;
    }

    try {
      await yearButton.click({ timeout: 2_000 });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }

  await yearButton.click();
}

test('home loads', async ({ page }) => {
  await page.goto('/');
  await ensureUserGateCleared(page);
  await expect(page).toHaveTitle(/Master Hub/i);
});

test('accounting page loads', async ({ page }) => {
  await page.goto('/accounting');
  await ensureUserGateCleared(page);
  await expect(page.getByText('会計（請求書/報告書）')).toBeVisible();
  await expect(page.getByRole('button', { name: '会計Ping' })).toBeVisible();
});

test('management page loads', async ({ page }) => {
  await page.goto('/management');
  await ensureUserGateCleared(page);
  await expect(page.locator('#management')).toHaveCount(1);
});

test('site-ledger page loads', async ({ page }) => {
  await page.goto('/site-ledger');
  await ensureUserGateCleared(page);
  await expect(page.locator('#site-ledger')).toHaveCount(1);
});

test('multi page loads', async ({ page }) => {
  await page.goto('/multi');
  await ensureUserGateCleared(page);
  await expect(page.getByRole('heading', { name: '集計' })).toBeVisible();
});

test('partners page loads', async ({ page }) => {
  await page.goto('/partners');
  await expect(page.getByRole('heading', { name: '関係会社' })).toBeVisible();
});

test('templates pdf endpoint returns a PDF', async ({ request }) => {
  const res = await request.post('/api/templates/pdf', {
    data: {
      kind: 'invoice',
      title: '請求書',
      subtitle: 'E2E',
      lines: ['現場: E2E', 'テスト行'],
    },
  });
  expect(res.ok()).toBeTruthy();
  const contentType = res.headers()['content-type'] ?? '';
  expect(contentType).toContain('application/pdf');
  const disp = res.headers()['content-disposition'] ?? '';
  expect(disp).toContain('attachment');
  const body = await res.body();
  expect(body.byteLength).toBeGreaterThan(100);
});

test('year summary cell drills down to month view', async ({ page }) => {
  await page.goto('/');
  await ensureUserGateCleared(page);
  await openYearMode(page);
  await expect(page.getByText('年予定（サマリ）')).toBeVisible();
  await expect(page.getByTestId('year-grid')).toBeVisible();

  const anyCell = page.locator('[data-testid^="year-cell-"]').first();
  const emptyState = page.getByText('従業員が未登録、またはデータ取得に失敗しました。');
  await expect(anyCell.or(emptyState)).toBeVisible();

  if ((await anyCell.count()) > 0) {
    const tid = await anyCell.getAttribute('data-testid');
    const m = tid?.match(/^year-cell-(.+?)-(\d{4}-\d{2})$/);
    const userId = m?.[1];

    await anyCell.click();
    await expect(page.getByTestId('modebar-month')).toBeVisible();

    if (userId) {
      const row = page.locator(`[data-testid="user-row-${userId}"]`);
      await expect(row).toHaveAttribute('aria-current', 'true');
      await expect(row).toBeVisible();

      await page.getByRole('button', { name: '週予定' }).click();
      await expect(page.getByTestId('modebar-week')).toBeVisible();
      const weekRow = page.locator(`[data-testid="user-row-${userId}"]`);
      if ((await weekRow.count()) > 0) {
        await expect(weekRow).toHaveAttribute('aria-current', 'true');
      }
    }
  } else {
    await expect(emptyState).toBeVisible();
  }
});

test('selected user chip can clear selection', async ({ page }) => {
  await page.goto('/');
  await ensureUserGateCleared(page);
  await openYearMode(page);
  await expect(page.getByText('年予定（サマリ）')).toBeVisible();
  await expect(page.getByTestId('year-grid')).toBeVisible();

  const anyCell = page.locator('[data-testid^="year-cell-"]').first();
  const emptyState = page.getByText('従業員が未登録、またはデータ取得に失敗しました。');
  await expect(anyCell.or(emptyState)).toBeVisible();

  if ((await anyCell.count()) > 0) {
    const tid = await anyCell.getAttribute('data-testid');
    const m = tid?.match(/^year-cell-(.+?)-(\d{4}-\d{2})$/);
    const userId = m?.[1];

    await anyCell.click();
    await expect(page.getByTestId('modebar-month')).toBeVisible();

    if (userId) {
      const row = page.locator(`[data-testid="user-row-${userId}"]`);
      await expect(row).toHaveAttribute('aria-current', 'true');

      const chip = page.getByTestId('selected-user-chip');
      if ((await chip.count()) > 0) {
        await expect(chip).toBeVisible();
        await page.getByTestId('clear-selected-user').click();
        await expect(chip).toHaveCount(0);
        await expect(row).not.toHaveAttribute('aria-current', 'true');
      }
    }
  } else {
    await expect(emptyState).toBeVisible();
  }
});

test('accounting ping returns ok', async ({ request }) => {
  const res = await request.get('/api/accounting/ping');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, provider: 'jdl' });
});

test('accounting exports endpoint returns list', async ({ request }) => {
  const res = await request.get('/api/accounting/exports');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, provider: 'jdl' });
  expect(Array.isArray(json.files)).toBeTruthy();
});

test('accounting export file delete returns 404 when missing', async ({ request }) => {
  const res = await request.delete('/api/accounting/exports/__e2e_missing__.csv');
  expect(res.status()).toBe(404);
  const json = await res.json();
  expect(json).toMatchObject({ ok: false });
});

test('accounting export preset endpoint returns ok', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.get('/api/accounting/export-preset');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, key: 'default' });
});

test('accounting export preset endpoint supports upsert (dev)', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.post('/api/accounting/export-preset', {
    data: {
      key: 'default',
      name: 'Default Accounting CSV Export',
      body: { metaKeys: ['project'] },
    },
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true });
});

test('accounting export presets endpoint returns list', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.get('/api/accounting/export-presets');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true });
  expect(Array.isArray(json.presets)).toBeTruthy();
});

test('accounting export returns csv', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.post('/api/accounting/export', { data: {} });
  expect(res.ok()).toBeTruthy();
  const contentType = res.headers()['content-type'] ?? '';
  expect(contentType).toContain('text/csv');
  const text = await res.text();
  expect(text).toContain('id,date,startAt');
});

test('accounting export supports metaEquals filters', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.post('/api/accounting/export', {
    data: { metaKeys: ['project'], metaEquals: { project: 'A' } },
  });
  expect(res.ok()).toBeTruthy();
  const text = await res.text();
  expect(text).toContain('meta.project');
});

test('accounting sync accepts metaKeys', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.post('/api/accounting/sync', {
    data: { metaKeys: ['project'] },
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, provider: 'jdl' });
});

test('queue enqueue returns 503 quickly when Redis is not configured', async ({ request }) => {
  test.skip(!!process.env.REDIS_URL, 'REDIS_URL is set; this test only asserts behavior when Redis is not configured');

  const started = Date.now();
  const res = await request.post('/api/queue/reminders/enqueue', { data: { message: 'e2e', delayMs: 0 } });
  const elapsedMs = Date.now() - started;

  expect(res.status()).toBe(503);
  // Should fail fast (no hanging).
  expect(elapsedMs).toBeLessThan(1000);
  const json = await res.json();
  expect(json).toMatchObject({ ok: false });
});

test('schedule week endpoint returns ok', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.get('/api/schedule/week');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true });
  expect(Array.isArray(json.days)).toBeTruthy();
  expect(Array.isArray(json.users)).toBeTruthy();
});

test('schedule month endpoint returns ok', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const res = await request.get(`/api/schedule/month?month=${encodeURIComponent(month)}`);
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, month });
  expect(Array.isArray(json.days)).toBeTruthy();
  expect(Array.isArray(json.users)).toBeTruthy();
});

test('schedule year summary endpoint returns ok', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const now = new Date();
  const year = now.getFullYear();
  const res = await request.get(`/api/schedule/year/summary?year=${encodeURIComponent(String(year))}`);
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, year });
  expect(Array.isArray(json.months)).toBeTruthy();
  expect(Array.isArray(json.users)).toBeTruthy();
});

test('schedule sites endpoint returns ok', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const res = await request.get('/api/schedule/sites');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true });
  expect(Array.isArray(json.names)).toBeTruthy();
});

test('schedule cell endpoint supports toggle and swap', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const existing = await prisma.user.findFirst({ select: { id: true } });
  const user =
    existing ??
    (await prisma.user.create({
      data: {
        email: `e2e-cell-${Date.now()}@example.test`,
        name: 'E2E Cell User',
      },
      select: { id: true },
    }));

  const userId = user.id;

  const siteName = `e2e-cell-site-${Date.now()}`;
  const createSiteRes = await request.post('/api/sites', {
    headers: getAdminHeaders(),
    data: { name: siteName },
  });
  expect(createSiteRes.ok()).toBeTruthy();
  const createdSiteJson = await createSiteRes.json();
  expect(createdSiteJson).toMatchObject({ ok: true });
  const siteId = createdSiteJson.site.id as string;

  const day = '2025-12-24';

  const toggleOn = await request.post('/api/schedule/cell', {
    data: { userId, day, action: 'toggle', siteId },
  });
  expect(toggleOn.ok()).toBeTruthy();
  const toggleOnJson = await toggleOn.json();
  expect(toggleOnJson).toMatchObject({ ok: true, action: 'toggle', changed: true });

  const toggleOff = await request.post('/api/schedule/cell', {
    data: { userId, day, action: 'toggle', siteId },
  });
  expect(toggleOff.ok()).toBeTruthy();
  const toggleOffJson = await toggleOff.json();
  expect(toggleOffJson).toMatchObject({ ok: true, action: 'toggle', changed: true, toggled: 'off' });

  const swap = await request.post('/api/schedule/cell', {
    data: { userId, day, action: 'swap' },
  });
  expect(swap.ok()).toBeTruthy();
  const swapJson = await swap.json();
  expect(swapJson).toMatchObject({ ok: true, action: 'swap' });
});

test('schedule swap-cells endpoint swaps two cells', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');

  const userA = await prisma.user.create({
    data: {
      email: `e2e-swap-a-${Date.now()}@example.test`,
      name: 'E2E Swap A',
    },
    select: { id: true },
  });
  const userB = await prisma.user.create({
    data: {
      email: `e2e-swap-b-${Date.now()}@example.test`,
      name: 'E2E Swap B',
    },
    select: { id: true },
  });

  const mkSite = async (name: string) => {
    const res = await request.post('/api/sites', { headers: getAdminHeaders(), data: { name } });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    return json.site.id as string;
  };

  const site1 = await mkSite(`e2e-swap-site1-${Date.now()}`);
  const site2 = await mkSite(`e2e-swap-site2-${Date.now()}`);
  const site3 = await mkSite(`e2e-swap-site3-${Date.now()}`);

  const dayA = '2025-12-26';
  const dayB = '2025-12-27';
  const kind = 'NORMAL';

  // Fill A cell with 2 slots.
  const a1 = await request.post('/api/schedule/cell', { data: { userId: userA.id, day: dayA, kind, action: 'toggle', siteId: site1 } });
  expect(a1.ok()).toBeTruthy();
  const a2 = await request.post('/api/schedule/cell', { data: { userId: userA.id, day: dayA, kind, action: 'add', siteId: site2 } });
  expect(a2.ok()).toBeTruthy();

  // Fill B cell with 1 slot.
  const b1 = await request.post('/api/schedule/cell', { data: { userId: userB.id, day: dayB, kind, action: 'toggle', siteId: site3 } });
  expect(b1.ok()).toBeTruthy();

  const snap = async (userId: string, day: string) => {
    const res = await request.get(`/api/schedule/cell/snapshot?userId=${encodeURIComponent(userId)}&day=${encodeURIComponent(day)}&kind=${encodeURIComponent(kind)}`);
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    return (json.slots ?? [null, null]) as [string | null, string | null];
  };

  const beforeA = await snap(userA.id, dayA);
  const beforeB = await snap(userB.id, dayB);

  const swapRes = await request.post('/api/schedule/cell/swap-cells', {
    data: {
      kind,
      from: { userId: userA.id, day: dayA },
      to: { userId: userB.id, day: dayB },
    },
  });
  expect(swapRes.ok()).toBeTruthy();
  const swapJson = await swapRes.json();
  expect(swapJson).toMatchObject({ ok: true });

  const afterA = await snap(userA.id, dayA);
  const afterB = await snap(userB.id, dayB);

  expect(afterA).toEqual(beforeB);
  expect(afterB).toEqual(beforeA);
});

test('weekhub: drag site from list to cell assigns', async ({ page }) => {
  test.skip(!dbAvailable, 'DB is not available');

  const user = await prisma.user.create({
    data: {
      email: `e2e-weekhub-dnd-${Date.now()}@example.test`,
      name: 'E2E WeekHub DnD',
      kind: 'NORMAL',
      canEditSchedule: true,
    },
    select: { id: true },
  });

  await page.goto('/?mode=week');
  await loginAs(page, user.id);
  await ensureUserGateCleared(page);

  await expect(page.getByTestId('modebar-week')).toBeVisible();

  const siteName = `e2e-weekhub-site-${Date.now()}`;
  const createSiteRes = await page.request.post('/api/sites', { data: { name: siteName } });
  expect(createSiteRes.ok()).toBeTruthy();
  const siteJson = await createSiteRes.json();
  expect(siteJson).toMatchObject({ ok: true });
  const siteId = siteJson.site.id as string;

  await page.goto('/?mode=week');
  await loginAs(page, user.id);
  await ensureUserGateCleared(page);
  await expect(page.getByTestId('modebar-week')).toBeVisible();
  await enterWeekHubEditMode(page, user.id);

  // Wait until the new site is present in the list.
  const siteBtn = page.locator(`button[data-site-id="${siteId}"]`);
  await expect(siteBtn).toHaveCount(1, { timeout: 15_000 });
  await siteBtn.scrollIntoViewIfNeeded();

  const anyCell = page.locator(`[data-testid^="cell-${user.id}-"]`).first();
  await expect(anyCell).toHaveCount(1, { timeout: 15_000 });

  await dndWithData(page, siteBtn, anyCell, {
    'application/x-masterhub-site': JSON.stringify({ siteId, label: siteName }),
    'text/plain': siteName,
  });
  await expect(anyCell).toContainText(siteName, { timeout: 15_000 });
});

test('weekhub: drag cell to cell copies into target', async ({ page }) => {
  test.skip(!dbAvailable, 'DB is not available');

  const user = await prisma.user.create({
    data: {
      email: `e2e-weekhub-swap-${Date.now()}@example.test`,
      name: 'E2E WeekHub Swap',
      kind: 'NORMAL',
      canEditSchedule: true,
    },
    select: { id: true },
  });

  await page.goto('/?mode=week');
  await loginAs(page, user.id);
  await ensureUserGateCleared(page);
  await expect(page.getByTestId('modebar-week')).toBeVisible();

  const mkSite = async (name: string) => {
    const res = await page.request.post('/api/sites', { data: { name } });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    return json.site.id as string;
  };

  const site1Name = `e2e-weekhub-s1-${Date.now()}`;
  const site2Name = `e2e-weekhub-s2-${Date.now()}`;
  const site1 = await mkSite(site1Name);
  const site2 = await mkSite(site2Name);

  await enterWeekHubEditMode(page, user.id);

  const cells = page.locator(`[data-testid^="cell-${user.id}-"]`);
  await expect(cells).toHaveCount(7, { timeout: 15_000 });
  const cellA = cells.nth(0);
  const cellB = cells.nth(1);
  const dayA = await cellA.getAttribute('data-cell-day');
  const dayB = await cellB.getAttribute('data-cell-day');
  expect(dayA).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(dayB).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const kind = 'NORMAL';
  const setA = await page.request.post('/api/schedule/cell', {
    data: { userId: user.id, day: dayA, kind, action: 'toggle', siteId: site1 },
  });
  expect(setA.ok()).toBeTruthy();
  const setB = await page.request.post('/api/schedule/cell', {
    data: { userId: user.id, day: dayB, kind, action: 'toggle', siteId: site2 },
  });
  expect(setB.ok()).toBeTruthy();

  await page.goto('/?mode=week');
  await loginAs(page, user.id);
  await ensureUserGateCleared(page);
  await expect(page.getByTestId('modebar-week')).toBeVisible();
  await enterWeekHubEditMode(page, user.id);
  const refreshedCells = page.locator(`[data-testid^="cell-${user.id}-"]`);
  const refreshedCellA = refreshedCells.nth(0);
  const refreshedCellB = refreshedCells.nth(1);
  await expect(refreshedCellA).toContainText(site1Name, { timeout: 15_000 });
  await expect(refreshedCellB).toContainText(site2Name, { timeout: 15_000 });

  await dndWithData(page, refreshedCellA, refreshedCellB, {
    'application/x-masterhub-cell': JSON.stringify({ userId: user.id, day: dayA, kind }),
    'text/plain': String(dayA),
  });
  await expect(refreshedCellA).toContainText(site1Name, { timeout: 15_000 });
  await expect(refreshedCellB).toContainText(site2Name, { timeout: 15_000 });
  await expect(refreshedCellB).toContainText(site1Name, { timeout: 15_000 });
});

test('weekhub: swap action can be armed from toolbar', async ({ page }) => {
  test.skip(!dbAvailable, 'DB is not available');

  const user = await prisma.user.create({
    data: {
      email: `e2e-weekhub-clickswap-${Date.now()}@example.test`,
      name: 'E2E WeekHub ClickSwap',
      kind: 'NORMAL',
      canEditSchedule: true,
    },
    select: { id: true },
  });

  await page.goto('/?mode=week');
  await loginAs(page, user.id);
  await ensureUserGateCleared(page);
  await expect(page.getByTestId('modebar-week')).toBeVisible();

  const mkSite = async (name: string) => {
    const res = await page.request.post('/api/sites', { data: { name } });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
    return json.site.id as string;
  };

  const site1Name = `e2e-weekhub-cs1-${Date.now()}`;
  const site2Name = `e2e-weekhub-cs2-${Date.now()}`;
  const site1 = await mkSite(site1Name);
  const site2 = await mkSite(site2Name);

  await enterWeekHubEditMode(page, user.id);

  const cells = page.locator(`[data-testid^="cell-${user.id}-"]`);
  await expect(cells).toHaveCount(7, { timeout: 15_000 });
  const cellA = cells.nth(0);
  const dayA = await cellA.getAttribute('data-cell-day');
  expect(dayA).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const kind = 'NORMAL';
  const setA = await page.request.post('/api/schedule/cell', {
    data: { userId: user.id, day: dayA, kind, action: 'toggle', siteId: site1 },
  });
  expect(setA.ok()).toBeTruthy();
  const setB = await page.request.post('/api/schedule/cell', {
    data: { userId: user.id, day: dayA, kind, action: 'add', siteId: site2 },
  });
  expect(setB.ok()).toBeTruthy();

  await page.goto('/?mode=week');
  await loginAs(page, user.id);
  await ensureUserGateCleared(page);
  await expect(page.getByTestId('modebar-week')).toBeVisible();
  const refreshedCellA = page.locator(`[data-testid^="cell-${user.id}-"]`).first();
  await expect(refreshedCellA).toContainText(site1Name, { timeout: 15_000 });
  await expect(refreshedCellA).toContainText(site2Name, { timeout: 15_000 });

  await page.getByTestId('cell-action-swap').click();
  await expect(page.getByTestId('cell-action-swap')).toHaveAttribute('aria-pressed', 'true');
});

test('sites depreciation-counts endpoint returns ok', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const res = await request.get(`/api/sites/depreciation-counts?month=${encodeURIComponent(month)}`);
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toMatchObject({ ok: true, month });
  expect(Array.isArray(json.items)).toBeTruthy();
});

test('schedule auto-fill creates entries and is idempotent', async ({ request }) => {
  test.skip(!dbAvailable, 'DB is not available');
  const existing = await prisma.user.findFirst({ select: { id: true } });
  const user =
    existing ??
    (await prisma.user.create({
      data: {
        email: `e2e-${Date.now()}@example.test`,
        name: 'E2E User',
      },
      select: { id: true },
    }));

  const userId = user.id;

  const siteName = `e2e-auto-fill-${Date.now()}`;
  const createSiteRes = await request.post('/api/sites', {
    headers: getAdminHeaders(),
    data: { name: siteName },
  });
  expect(createSiteRes.ok()).toBeTruthy();
  const createdSiteJson = await createSiteRes.json();
  expect(createdSiteJson).toMatchObject({ ok: true });
  const siteId = createdSiteJson.site.id as string;

  const setRuleRes = await request.post('/api/sites/repeat-rule', {
    headers: getAdminHeaders(),
    data: {
      siteId,
      repeatRule: { intervalMonths: 1, weekdays: [], monthDays: [1] },
    },
  });
  expect(setRuleRes.ok()).toBeTruthy();

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const first = await request.post('/api/schedule/auto-fill', {
    data: { userId, siteId, month },
  });
  expect(first.ok()).toBeTruthy();
  const firstJson = await first.json();
  expect(firstJson).toMatchObject({ ok: true, created: 1, skipped: 0 });

  const second = await request.post('/api/schedule/auto-fill', {
    data: { userId, siteId, month },
  });
  expect(second.ok()).toBeTruthy();
  const secondJson = await second.json();
  expect(secondJson).toMatchObject({ ok: true, created: 0, skipped: 1 });

  // intervalMonths gating (anchored to Site.createdAt month).
  const setRuleIntervalRes = await request.post('/api/sites/repeat-rule', {
    headers: getAdminHeaders(),
    data: {
      siteId,
      repeatRule: { intervalMonths: 2, weekdays: [], monthDays: [1] },
    },
  });
  expect(setRuleIntervalRes.ok()).toBeTruthy();

  const third = await request.post('/api/schedule/auto-fill', {
    data: { userId, siteId, month: nextMonth },
  });
  expect(third.ok()).toBeTruthy();
  const thirdJson = await third.json();
  expect(thirdJson).toMatchObject({ ok: true, created: 0, skipped: 0, reason: 'ペース対象外の月です' });

  // days[] restriction (e.g., this-week only). Use a new site with intervalMonths=1 and monthDays=[1].
  const siteName2 = `e2e-auto-fill-days-${Date.now()}`;
  const createSiteRes2 = await request.post('/api/sites', {
    headers: getAdminHeaders(),
    data: { name: siteName2 },
  });
  expect(createSiteRes2.ok()).toBeTruthy();
  const createdSiteJson2 = await createSiteRes2.json();
  const siteId2 = createdSiteJson2.site.id as string;

  const setRuleRes2 = await request.post('/api/sites/repeat-rule', {
    headers: getAdminHeaders(),
    data: {
      siteId: siteId2,
      repeatRule: { intervalMonths: 1, weekdays: [], monthDays: [1] },
    },
  });
  expect(setRuleRes2.ok()).toBeTruthy();

  const ymd1 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const ymd2 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`;
  const restricted = await request.post('/api/schedule/auto-fill', {
    data: { userId, siteId: siteId2, month, days: [ymd2] },
  });
  expect(restricted.ok()).toBeTruthy();
  const restrictedJson = await restricted.json();
  // Day 2 does not match monthDays=[1], so nothing is created.
  expect(restrictedJson).toMatchObject({ ok: true, created: 0, skipped: 0 });

  const restricted2 = await request.post('/api/schedule/auto-fill', {
    data: { userId, siteId: siteId2, month, days: [ymd1, ymd2] },
  });
  expect(restricted2.ok()).toBeTruthy();
  const restrictedJson2 = await restricted2.json();
  expect(restrictedJson2).toMatchObject({ ok: true, created: 1 });
});
