import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import net from 'node:net';
import { PrismaClient } from '../src/generated/prisma';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const prisma = new PrismaClient();

let dbAvailable = false;

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

test('home loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Master Hub/i);
});

test('accounting page loads', async ({ page }) => {
  await page.goto('/accounting');
  await expect(page.getByText('会計（請求書/報告書）')).toBeVisible();
  await expect(page.getByRole('button', { name: '会計Ping' })).toBeVisible();
});

test('management page loads', async ({ page }) => {
  await page.goto('/management');
  await expect(page.locator('#management')).toHaveCount(1);
});

test('site-ledger page loads', async ({ page }) => {
  await page.goto('/site-ledger');
  await expect(page.locator('#site-ledger')).toHaveCount(1);
});

test('multi page loads', async ({ page }) => {
  await page.goto('/multi');
  await expect(page.locator('#mode-tabs')).toHaveCount(1);
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

  await page.getByRole('button', { name: '年予定' }).click();
  await expect(page.getByText('年予定（サマリ）')).toBeVisible();

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

  await page.getByRole('button', { name: '年予定' }).click();
  await expect(page.getByText('年予定（サマリ）')).toBeVisible();

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
      await expect(page.getByTestId('selected-user-chip')).toBeVisible();
      const row = page.locator(`[data-testid="user-row-${userId}"]`);
      await expect(row).toHaveAttribute('aria-current', 'true');

      await page.getByTestId('clear-selected-user').click();
      await expect(page.getByTestId('selected-user-chip')).toHaveCount(0);
      await expect(row).not.toHaveAttribute('aria-current', 'true');
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
