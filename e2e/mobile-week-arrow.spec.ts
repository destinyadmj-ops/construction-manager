import { test, expect, type Page } from '@playwright/test';

// DB 不要: API をすべてモックし、スマホ週予定の「▼は複数現場のみ」ルールを確認する。
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const USER_ID = 'u-arrow';

function weekDays(weekStart: string) {
  const [y, m, d] = weekStart.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(y, m - 1, d + i);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  });
}

async function mockApis(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/auth/me**', (route) =>
    route.fulfill({ json: { ok: true, user: { id: USER_ID, name: 'テスト太郎', email: null, kind: 'NORMAL' } } }),
  );
  await page.route('**/api/sites**', (route) =>
    route.fulfill({ json: { ok: true, sites: [{ id: 'site-a', name: '現場A' }, { id: 'site-b', name: '現場B' }] } }),
  );
  await page.route('**/api/schedule/week**', (route) => {
    const weekStart = new URL(route.request().url()).searchParams.get('weekStart') ?? '';
    const days = weekDays(weekStart);
    const site = (label: string) => ({ label, color: 'default', kind: 'site', syncSource: null });
    const longName = 'とても長い現場名の株式会社サンプル建設工業 本店ビル新築工事 第二期';
    const cell = (groups: unknown[]) => ({ slot1: null, slot2: null, groups });
    return route.fulfill({
      json: {
        ok: true,
        weekStart,
        days,
        users: [{ id: USER_ID, name: 'テスト太郎', email: null, nameLabelColor: 'default' }],
        grid: {
          [USER_ID]: {
            [days[0]]: cell([{ items: [site('現場A')], note: null }]),
            [days[1]]: cell([{ items: [site(longName)], note: null }]),
            [days[2]]: cell([{ items: [site('現場A')], note: '午前のみ' }]),
            [days[3]]: cell([{ items: [site('現場A'), site('現場B')], note: null }]),
            [days[4]]: cell([{ items: [site('現場A'), site('現場A')], note: null }]),
          },
        },
      },
    });
  });
}

test('mobile week grid shows arrow only for multi-site cells', async ({ page }) => {
  await mockApis(page);
  await page.goto('/mobile/week-hub');

  const cells = page.locator(`[data-testid^="mobile-week-cell-menu-${USER_ID}-"]`);
  await expect(cells).toHaveCount(5);

  const arrowOf = (index: number) => cells.nth(index).getByText('▼', { exact: true });

  // 1現場(短い名前 / 長い名前 / 追記つき)は ▼ なし
  await expect(arrowOf(0)).toHaveCount(0);
  await expect(arrowOf(1)).toHaveCount(0);
  await expect(arrowOf(2)).toHaveCount(0);
  // 2現場は ▼ あり
  await expect(arrowOf(3)).toHaveCount(1);
  // 同じ現場名の重複は 1現場扱い
  await expect(arrowOf(4)).toHaveCount(0);

  // 1現場でもタップでメニューが開き、追記を含む全文が見える
  await cells.nth(2).click();
  const menu = page.getByTestId('mobile-cell-entry-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('現場A');
  await expect(menu).toContainText('午前のみ');
});
