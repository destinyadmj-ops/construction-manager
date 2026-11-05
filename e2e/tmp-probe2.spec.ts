import { test, type Page } from '@playwright/test';

const pats = ['d"日"(aaa)', 'd"日（"aaa"）"', 'm/d(aaa)', 'yyyy/m/d', 'yyyy/m/d(aaa)', 'm"月"d"日"', 'aaa', 'aaaa', '[$-411]ggge"年"m"月"d"日"', 'd"日"', 'm/d', 'd"日"\\(aaa\\)', 'yyyy"年"m"月"d"日"', 'ddd', 'dddd', 'mm/dd'];
const styles: Record<string, unknown> = {};
const row: Record<number, unknown> = {};
pats.forEach((p, i) => {
  styles['p' + i] = { n: { pattern: p } };
  row[i] = { v: 46300, t: 2, s: 'p' + i };
});
const snapshot = {
  id: 'work-slip-book', name: 'x', appVersion: '3.0.0-alpha', locale: 'jaJP', styles,
  sheetOrder: ['s1'],
  sheets: { s1: { id: 's1', name: 'probe', rowCount: 30, columnCount: 20, cellData: { 0: row }, mergeData: [], columnData: Object.fromEntries(pats.map((_, i) => [i, { w: 160 }])), rowData: {} } },
};
const meta = { version: 1, updatedAt: '2026-11-05T00:00:00.000Z', updatedByName: 'E2E', source: 'import', sourceFileName: 'x.xls' };

async function mock(page: Page) {
  await page.route('**/api/auth/me**', (route) => route.fulfill({ json: { ok: true, user: { id: 'u', name: 'E', email: null, kind: 'NORMAL', canEditSchedule: true, canGrantScheduleEdit: false } } }));
  await page.route('**/api/work-slip-book', (route) => route.fulfill({ json: { ok: true, meta, snapshot } }));
  await page.route('**/api/work-slip-book/versions', (route) => route.fulfill({ json: { ok: true, current: 1, versions: [1] } }));
}

test('probe', async ({ page }) => {
  await page.setViewportSize({ width: 2800, height: 700 });
  await mock(page);
  await page.goto('/site-ledger/work-slip-book');
  await page.locator('canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.env.TEMP + '\\probe-d.png', clip: { x: 440, y: 225, width: 2360, height: 60 } });
});


