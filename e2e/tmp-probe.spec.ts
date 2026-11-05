import { test, type Page } from '@playwright/test';

const cell = (v: string | number, t = 1, s?: string) => ({ v, t, ...(s ? { s } : {}) });
const snapshot = {
  id: 'work-slip-book', name: 'x', appVersion: '3.0.0-alpha', locale: 'jaJP', styles: {},
  sheetOrder: ['s1'],
  sheets: {
    s1: {
      id: 's1', name: 'probe', rowCount: 30, columnCount: 12,
      cellData: {
        0: { 0: cell('A_text_ok'), 1: cell('日（）'), 2: cell('日(月)'), 3: cell('abc日'), 4: cell('日'), 5: cell('（）') },
        1: { 0: cell('2024/06迄改装の為中止'), 1: cell('日（ ）'), 2: cell('月日（）'), 3: cell('（）'), 4: cell('()'), 5: cell('日()') },
      },
      mergeData: [], columnData: { 1: { w: 191 }, 2: { w: 191 }, 3: { w: 191 }, 4: { w: 191 }, 5: { w: 191 } }, rowData: {},
    },
  },
};
const meta = { version: 1, updatedAt: '2026-11-05T00:00:00.000Z', updatedByName: 'E2E', source: 'import', sourceFileName: 'x.xls' };

async function mock(page: Page) {
  await page.route('**/api/auth/me**', (route) => route.fulfill({ json: { ok: true, user: { id: 'u', name: 'E', email: null, kind: 'NORMAL', canEditSchedule: true, canGrantScheduleEdit: false } } }));
  const real = JSON.parse(require('node:fs').readFileSync(process.env.TEMP + '\\\\real-snapshot.json', 'utf8')); const names = real.sheetOrder.map((id: string) => real.sheets[id].name); const act = real.sheetOrder[names.findIndex((n: string) => n.normalize('NFKC').includes('2026年10月'))]; real.sheetOrder = [act, ...real.sheetOrder.filter((x: string) => x !== act)]; await page.route('**/api/work-slip-book', (route) => route.fulfill({ json: { ok: true, meta, snapshot: real } }));
  await page.route('**/api/work-slip-book/versions', (route) => route.fulfill({ json: { ok: true, current: 1, versions: [1] } }));
}

test('probe', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 900 }); await mock(page);
  await page.goto('/site-ledger/work-slip-book');
  await page.locator('canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.env.TEMP + '\\probe.png', clip: { x: 0, y: 100, width: 2400, height: 700 } });
});




