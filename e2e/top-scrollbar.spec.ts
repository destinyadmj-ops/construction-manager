import { expect, test, type Page } from '@playwright/test';

async function closeGate(page: Page) {
  const gateTitle = page.getByText('初回ログイン / ユーザー選択');
  const closeButton = page.getByRole('button', { name: '閉じる' });
  for (let i = 0; i < 6; i++) {
    const visible = await gateTitle.isVisible().catch(() => false);
    if (!visible) return;
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await page.waitForTimeout(300);
    } else {
      await page.waitForTimeout(500);
    }
  }
}

// ログイン済み状態だけ差し替える（他APIは実データの読み取りのみ。書き込みは行わない）
async function mockAuth(page: Page) {
  await page.route('**/api/auth/me**', (route) =>
    route.fulfill({ json: { ok: true, user: { id: 'e2e-user', name: 'E2E', email: null, kind: 'NORMAL' } } }),
  );
}

async function openMode(page: Page, label: '月予定' | '週予定' | '年予定') {
  await closeGate(page);
  await page.getByRole('button', { name: label }).click();
}

type Kind = 'month' | 'week' | 'year';

// 表がはみ出す時だけバーが出て、本体と相互に同期すること（データ非依存の不変条件で確認）
async function checkInvariant(page: Page, kind: Kind) {
  const body = page.getByTestId(`${kind}-grid-body-scroll`);
  await expect(body).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);

  const m = await body.evaluate((el) => ({ cw: el.clientWidth, sw: el.scrollWidth }));
  const overflow = m.sw - m.cw > 1;
  test.info().annotations.push({ type: 'overflow', description: `${kind}: cw=${m.cw} sw=${m.sw}` });
  const bar = page.getByTestId(`${kind}-grid-top-scrollbar`);

  if (!overflow) {
    await expect(bar).toHaveCount(0);
    return { overflow };
  }

  await expect(bar).toBeVisible();
  await expect(page.getByTestId(`${kind}-grid-top-scrollbar-visual`)).toBeVisible();

  // バー -> 本体
  await bar.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(200);
  const maxScroll = m.sw - m.cw;
  const afterBar = await body.evaluate((el) => el.scrollLeft);
  expect(Math.abs(afterBar - maxScroll)).toBeLessThanOrEqual(2);

  // 本体 -> バー
  await body.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.waitForTimeout(200);
  const barLeft = await bar.evaluate((el) => el.scrollLeft);
  expect(barLeft).toBeLessThanOrEqual(2);

  return { overflow };
}

test.describe('top horizontal scrollbar', () => {
  test.use({ viewport: { width: 1000, height: 900 } });

  test('month: root is not stretched and bar follows overflow', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/');
    await openMode(page, '月予定');
    const body = page.getByTestId('month-grid-body-scroll');
    await expect(body).toBeVisible({ timeout: 30_000 });
    // 右列が表の幅で押し広げられず、本体自身がスクロール領域になっていること
    const right = await body.evaluate((el) => el.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(1000 + 1);
    await checkInvariant(page, 'month');
    // 既存testidが維持されていること（はみ出す幅では必ず出る）
    await expect(page.getByTestId('month-grid-top-scrollbar')).toBeVisible();
  });

  test('week: bar follows overflow', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/');
    await openMode(page, '週予定');
    await checkInvariant(page, 'week');
  });

  test('year: bar follows overflow', async ({ page }) => {
    await mockAuth(page);
    await page.goto('/');
    await openMode(page, '年予定');
    await checkInvariant(page, 'year');
  });
});
