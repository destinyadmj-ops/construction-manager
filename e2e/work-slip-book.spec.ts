import { expect, test, type Page } from '@playwright/test';

// API は全てモック(実DB・実ファイルには触れない)
const snapshot = {
  id: 'work-slip-book',
  name: '作業伝票',
  appVersion: '3.0.0-alpha',
  locale: 'jaJP',
  styles: {},
  sheetOrder: ['sheet-1', 'sheet-2'],
  sheets: {
    'sheet-1': {
      id: 'sheet-1',
      name: '作業伝票2026年10月',
      rowCount: 100,
      columnCount: 26,
      cellData: { 0: { 0: { v: '会社', t: 1 }, 1: { v: '現場', t: 1 } }, 1: { 0: { v: 'テスト会社', t: 1 }, 1: { v: 'テスト現場', t: 1 } } },
      mergeData: [],
      columnData: {},
      rowData: {},
    },
    'sheet-2': { id: 'sheet-2', name: '作業伝票オリジナル', rowCount: 100, columnCount: 26, cellData: {}, mergeData: [], columnData: {}, rowData: {} },
  },
};
const meta = { version: 3, updatedAt: '2026-11-04T00:00:00.000Z', updatedByName: 'E2E', source: 'import', sourceFileName: 'x.xls' };

async function mock(page: Page, canEdit: boolean) {
  await page.route('**/api/auth/me**', (route) =>
    route.fulfill({ json: { ok: true, user: { id: 'e2e-user', name: 'E2E', email: null, kind: 'NORMAL', canEditSchedule: canEdit, canGrantScheduleEdit: false } } }),
  );
  await page.route('**/api/work-slip-book', (route) => route.fulfill({ json: { ok: true, meta, snapshot } }));
  await page.route('**/api/work-slip-book/versions', (route) => route.fulfill({ json: { ok: true, current: 3, versions: [3, 2, 1] } }));
}

test('作業伝票ブック: 編集権限者はブック(Univer)が開く', async ({ page }) => {
  await mock(page, true);
  await page.goto('/site-ledger/work-slip-book');
  await expect(page.getByTestId('work-slip-book-meta')).toContainText('v3', { timeout: 30_000 });
  const editor = page.getByTestId('work-slip-book-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '保存 (Ctrl+S)' })).toBeDisabled();
});

test('作業伝票ブック: 編集権限が無い人は入室できない', async ({ page }) => {
  await mock(page, false);
  await page.goto('/site-ledger/work-slip-book');
  await expect(page.getByTestId('work-slip-book-denied')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('work-slip-book-editor')).toHaveCount(0);
});

test('作業伝票ブック: 共有フォルダが見えない時はこのPCのExcelを選ぶ導線が出る', async ({ page }) => {
  await mock(page, true);
  await page.route('**/api/work-slip-book', (route) => route.fulfill({ json: { ok: true, meta: null, snapshot: null } }));
  await page.route('**/api/work-slip-book/import', (route) => route.fulfill({ status: 404, json: { ok: false, error: '共有フォルダが見えません' } }));
  await page.goto('/site-ledger/work-slip-book');
  await page.getByRole('button', { name: '共有フォルダの作業伝票から作成' }).click({ timeout: 30_000 });
  await expect(page.getByTestId('work-slip-book-shared-missing')).toBeVisible();
});