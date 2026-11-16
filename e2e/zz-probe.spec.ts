import { expect, test } from '@playwright/test';
const snapshot = { id: 'work-slip-book', name: 'x', appVersion: '3.0.0-alpha', locale: 'jaJP', styles: {}, sheetOrder: ['sheet-1'], sheets: { 'sheet-1': { id: 'sheet-1', name: 'S1', rowCount: 100, columnCount: 26, cellData: { 0: { 0: { v: 'a', t: 1 } } }, mergeData: [], columnData: {}, rowData: {} } } };
for (const w of [2400, 1500, 1000]) {
  test('probe ' + w, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await page.route('**/api/auth/me**', (r) => r.fulfill({ json: { ok: true, user: { id: 'e', name: 'E', email: null, kind: 'NORMAL', canEditSchedule: true, canGrantScheduleEdit: false } } }));
    await page.route('**/api/work-slip-book', (r) => r.fulfill({ json: { ok: true, meta: { version: 1, updatedAt: '2026-11-04T00:00:00.000Z', updatedByName: 'E', source: 'import', sourceFileName: 'x.xls' }, snapshot } }));
    await page.route('**/api/work-slip-book/versions', (r) => r.fulfill({ json: { ok: true, current: 1, versions: [1] } }));
    await page.goto('/site-ledger/work-slip-book');
    await expect(page.getByTestId('work-slip-book-editor').locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const ed = document.querySelector('[data-testid="work-slip-book-editor"]')!.getBoundingClientRect();
      const out: string[] = [`ed ${Math.round(ed.left)},${Math.round(ed.top)} ${Math.round(ed.width)}x${Math.round(ed.height)}`];
      for (const sel of ['[class*="univer-header"]', '[class*="toolbar"]', '[class*="formula-bar"]', '[class*="univer-formula"]']) {
        document.querySelectorAll(sel).forEach((el, i) => { if (i < 3) { const b = el.getBoundingClientRect(); out.push(`${sel}#${i} ${(el as HTMLElement).className.toString().slice(0, 60)} ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`); } });
      }
      return out.join('\n');
    });
    console.log('INFO' + w + '\n' + info);
    await page.screenshot({ path: process.env.TEMP + `/probe-bar-${w}.png`, clip: { x: 0, y: 0, width: Math.min(w, 2400), height: 330 } });
  });
}