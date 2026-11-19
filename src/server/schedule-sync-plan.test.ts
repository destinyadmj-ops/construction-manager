import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { Prisma } from '../generated/prisma';
import type { planScheduleCells as PlanFn, ScheduleDesiredRow, ScheduleExistingRow } from './shared-excel-sync';

let planScheduleCells: typeof PlanFn;

// prisma クライアントの import に DATABASE_URL が要る(接続はしない)
before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
  ({ planScheduleCells } = await import('./shared-excel-sync'));
});

type Color = 'default' | 'red';
type Item = { summary: string; color: Color };
type DbRow = ScheduleExistingRow;

const USERS = ['u1', 'u2', 'u3', 'u4'];
const DAYS = ['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10', '2030-01-11'];
// 別表記(別名)は同じ現場IDへ解決される。siteId が無い名前は文字列一致で扱う。
const SITES: Array<{ summary: string; siteId: string | null }> = [
  { summary: '甲ビル', siteId: 's1' },
  { summary: '甲 ビル 3F', siteId: 's1' },
  { summary: '乙マンション', siteId: 's2' },
  { summary: '丙センター', siteId: 's3' },
  { summary: '丁工場', siteId: 's4' },
  { summary: '丁工場 倉庫', siteId: 's4' },
  { summary: '戊ホール', siteId: null },
  { summary: '己ホール', siteId: null },
  { summary: '庚店舗', siteId: 's7' },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const siteIdOf = (summary: string) => SITES.find((s) => s.summary === summary)?.siteId ?? null;

// 実装と同じ「同じ人・日で同じ現場は1件」の畳み込み
function dedupe(items: Item[]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const item of items) {
    const siteId = siteIdOf(item.summary);
    const key = siteId ? `site:${siteId}` : `name:${item.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

type Original = Map<string, Item[]>;

function toDesired(original: Original): Map<string, ScheduleDesiredRow[]> {
  const map = new Map<string, ScheduleDesiredRow[]>();
  for (const [cellKey, rawItems] of original) {
    const [userId, dayYmd] = cellKey.split('|');
    const items = dedupe(rawItems);
    if (items.length === 0) continue;
    map.set(
      cellKey,
      items.map((item, index) => {
        // 実装と同じ: 赤はグループ1、項目番号はグループ内の順番
        const groupIndex = item.color === 'red' ? 1 : 0;
        const itemIndex = items.slice(0, index).filter((x) => (x.color === 'red' ? 1 : 0) === groupIndex).length;
        return {
          userId,
          dayYmd,
          summary: item.summary,
          siteId: siteIdOf(item.summary),
          labelColor: item.color,
          groupIndex,
          itemIndex,
          sourceKey: `${dayYmd}|${userId}|${item.summary}|${item.color}|${groupIndex}|${itemIndex}`,
        };
      }),
    );
  }
  return map;
}

function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function groupByCell(rows: DbRow[]): Map<string, DbRow[]> {
  const map = new Map<string, DbRow[]>();
  for (const row of [...rows].sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id))) {
    const key = `${row.userId}|${localYmd(row.startAt)}`;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

const hasSyncMeta = (row: DbRow) => {
  const meta = row.accountingMeta as Record<string, unknown> | null;
  return !!meta && typeof meta === 'object' && 'sharedExcelSync' in meta;
};

let idCounter = 0;

function syncOnce(db: DbRow[], original: Original) {
  const plan = planScheduleCells({
    desiredByCell: toDesired(original),
    existingByCell: groupByCell(db),
    workTableFileName: 'test.xlsx',
  });
  const deleted = new Set(plan.deleteIds);
  const updates = new Map(plan.updates.map((u) => [u.id, u.data]));
  const next: DbRow[] = [];
  for (const row of db) {
    if (deleted.has(row.id)) continue;
    const data = updates.get(row.id);
    next.push(data ? { ...row, startAt: data.startAt, summary: data.summary, siteId: data.siteId, accountingMeta: data.accountingMeta as Prisma.JsonValue } : row);
  }
  for (const c of plan.creates) {
    next.push({ id: `n${(idCounter += 1)}`, userId: c.userId, startAt: c.startAt, summary: c.summary, siteId: c.siteId, accountingMeta: c.accountingMeta as Prisma.JsonValue });
  }
  return { db: next, plan };
}

function assertConverged(db: DbRow[], original: Original, label: string) {
  const desired = toDesired(original);
  const cells = groupByCell(db);
  for (const [cellKey, wants] of desired) {
    const syncRows = (cells.get(cellKey) ?? []).filter(hasSyncMeta);
    assert.deepEqual(
      syncRows.map((r) => [r.summary, (r.accountingMeta as { labelColor?: string }).labelColor]),
      wants.map((w) => [w.summary, w.labelColor]),
      `${label}: ${cellKey} の内容/順序/色が原本と一致しない`,
    );
  }
  for (const [cellKey, rows] of cells) {
    if (desired.has(cellKey)) continue;
    assert.equal(rows.filter(hasSyncMeta).length, 0, `${label}: ${cellKey} に原本に無い同期予定が残っている`);
  }
}

function randomItems(rand: () => number): Item[] {
  const n = Math.floor(rand() * 5);
  const items: Item[] = [];
  for (let i = 0; i < n; i += 1) {
    items.push({ summary: SITES[Math.floor(rand() * SITES.length)].summary, color: rand() < 0.3 ? 'red' : 'default' });
  }
  return items;
}

function mutate(original: Original, rand: () => number) {
  const cellKey = `${USERS[Math.floor(rand() * USERS.length)]}|${DAYS[Math.floor(rand() * DAYS.length)]}`;
  const items = [...(original.get(cellKey) ?? [])];
  const op = Math.floor(rand() * 7);
  if (op === 0) items.push(randomItems(rand)[0] ?? { summary: SITES[0].summary, color: 'default' });
  else if (op === 1 && items.length) items.splice(Math.floor(rand() * items.length), 1);
  else if (op === 2 && items.length) items[Math.floor(rand() * items.length)] = { summary: SITES[Math.floor(rand() * SITES.length)].summary, color: 'default' };
  else if (op === 3 && items.length) {
    const i = Math.floor(rand() * items.length);
    items[i] = { ...items[i], color: items[i].color === 'red' ? 'default' : 'red' };
  } else if (op === 4 && items.length > 1) items.reverse();
  else if (op === 5) items.length = 0;
  else if (op === 6) {
    // 担当者の入れ替え: 別の人へ丸ごと移す
    const other = `${USERS[Math.floor(rand() * USERS.length)]}|${cellKey.split('|')[1]}`;
    original.set(other, [...items]);
    items.length = 0;
  }
  original.set(cellKey, items);
}

test('原本をランダムに編集して同期を繰り返しても、DB は常に原本へ収束し再実行で変化しない', () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const rand = mulberry32(seed);
    const original: Original = new Map();
    for (const user of USERS) for (const day of DAYS) original.set(`${user}|${day}`, randomItems(rand));

    // 初期DB: 手入力(メタ無し)・原本に無い同期由来・古い同期由来が混在
    let db: DbRow[] = [];
    for (const user of USERS) {
      for (const day of DAYS) {
        const [y, m, d] = day.split('-').map(Number);
        if (rand() < 0.4) {
          const site = SITES[Math.floor(rand() * SITES.length)];
          db.push({ id: `m${(idCounter += 1)}`, userId: user, startAt: new Date(y, m - 1, d, 9, 0), summary: site.summary, siteId: site.siteId, accountingMeta: null });
        }
        if (rand() < 0.2) {
          db.push({
            id: `s${(idCounter += 1)}`,
            userId: user,
            startAt: new Date(y, m - 1, d, 12, 0),
            summary: '古い予定',
            siteId: null,
            accountingMeta: { sharedExcelSync: { source: '作業表☆', rowKey: 'old' } } as Prisma.JsonValue,
          });
        }
      }
    }
    const initialManual = db.filter((r) => !hasSyncMeta(r)).length;

    for (let step = 0; step < 12; step += 1) {
      const synced = syncOnce(db, original);
      db = synced.db;
      assertConverged(db, original, `seed=${seed} step=${step}`);

      const again = syncOnce(db, original);
      assert.equal(again.plan.creates.length + again.plan.updates.length + again.plan.deleteIds.length, 0, `seed=${seed} step=${step}: 再実行で変化した`);
      db = again.db;

      // 同じ人・日の重複なし(同期由来の同一rowKey)
      const keys = db.filter(hasSyncMeta).map((r) => `${r.userId}|${localYmd(r.startAt)}|${(r.accountingMeta as { sharedExcelSync: { rowKey: string } }).sharedExcelSync.rowKey}`);
      assert.equal(new Set(keys).size, keys.length, `seed=${seed} step=${step}: 同期予定が重複`);

      mutate(original, rand);
      if (rand() < 0.2) {
        // 同期の合間に利用者が手入力で予定を足す
        const user = USERS[Math.floor(rand() * USERS.length)];
        const [y, m, d] = DAYS[Math.floor(rand() * DAYS.length)].split('-').map(Number);
        const site = SITES[Math.floor(rand() * SITES.length)];
        db.push({ id: `m${(idCounter += 1)}`, userId: user, startAt: new Date(y, m - 1, d, 9, 0), summary: site.summary, siteId: site.siteId, accountingMeta: null });
      }
    }
    assert.ok(db.filter((r) => !hasSyncMeta(r)).length <= initialManual + 12, 'manual 行が増えすぎ');
  }
});

test('原本から消えた予定は削除し、手入力の予定(原本と別の現場)は残す', () => {
  const original: Original = new Map([[`u1|${DAYS[0]}`, [{ summary: '甲ビル', color: 'default' }]]]);
  const [y, m, d] = DAYS[0].split('-').map(Number);
  let db: DbRow[] = [{ id: 'manual1', userId: 'u1', startAt: new Date(y, m - 1, d, 9, 0), summary: '丙センター', siteId: 's3', accountingMeta: null }];
  db = syncOnce(db, original).db;
  assert.equal(db.length, 2);
  original.set(`u1|${DAYS[0]}`, []);
  db = syncOnce(db, original).db;
  assert.deepEqual(db.map((r) => r.id), ['manual1']);
});

test('手入力の同じ現場の予定は原本の内容で上書きされる(ID は保たれる)', () => {
  const original: Original = new Map([[`u1|${DAYS[0]}`, [{ summary: '甲 ビル 3F', color: 'red' }]]]);
  const [y, m, d] = DAYS[0].split('-').map(Number);
  const db: DbRow[] = [{ id: 'manual1', userId: 'u1', startAt: new Date(y, m - 1, d, 9, 0), summary: '甲ビル', siteId: 's1', accountingMeta: null }];
  const { db: next, plan } = syncOnce(db, original);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'manual1');
  assert.equal(next[0].summary, '甲 ビル 3F');
  assert.equal(plan.counts.overwritten, 1);
});


test('現場名の文言だけ直したときは、同じ位置の同期由来の予定を更新する(削除+作成にしない・ID を保つ)', () => {
  const cell = `u1|${DAYS[0]}`;
  const original: Original = new Map([[cell, [{ summary: '甲ビル', color: 'default' }, { summary: '乙マンション', color: 'default' }]]]);
  let db = syncOnce([], original).db;
  const ids = db.map((r) => r.id).sort();
  original.set(cell, [{ summary: '丙センター', color: 'default' }, { summary: '乙マンション', color: 'default' }]);
  const { db: next, plan } = syncOnce(db, original);
  db = next;
  assert.deepEqual(db.map((r) => r.id).sort(), ids);
  assert.equal(plan.counts.created, 0);
  assert.equal(plan.counts.deleted, 0);
  assert.equal(plan.counts.updated, 1);
  assertConverged(db, original, '文言修正');
});

test('位置の対応づけは手入力の予定を対象にしない', () => {
  const cell = `u1|${DAYS[0]}`;
  const [y, m, d] = DAYS[0].split('-').map(Number);
  const manual: DbRow = {
    id: 'manual1',
    userId: 'u1',
    startAt: new Date(y, m - 1, d, 9, 0),
    summary: '戊ホール',
    siteId: null,
    accountingMeta: { scheduleGroupIndex: 0, scheduleItemIndex: 0 } as Prisma.JsonValue,
  };
  const original: Original = new Map([[cell, [{ summary: '甲ビル', color: 'default' }]]]);
  let db = syncOnce([manual], original).db;
  original.set(cell, [{ summary: '丙センター', color: 'default' }]);
  db = syncOnce(db, original).db;
  const kept = db.find((r) => r.id === 'manual1');
  assert.equal(kept?.summary, '戊ホール');
  assert.equal(db.filter(hasSyncMeta).length, 1);
  assertConverged(db, original, '手入力は対象外');
});

test('項目の削除と追加が同時でも、結果は原本と一致する(位置の誤対応でも)', () => {
  const cell = `u1|${DAYS[0]}`;
  const original: Original = new Map([[cell, [{ summary: '甲ビル', color: 'default' }, { summary: '乙マンション', color: 'default' }, { summary: '丙センター', color: 'default' }]]]);
  let db = syncOnce([], original).db;
  original.set(cell, [{ summary: '乙マンション', color: 'default' }, { summary: '丁工場', color: 'default' }, { summary: '丙センター', color: 'default' }]);
  db = syncOnce(db, original).db;
  assertConverged(db, original, '削除+追加');
  const again = syncOnce(db, original);
  assert.equal(again.plan.creates.length + again.plan.updates.length + again.plan.deleteIds.length, 0);
});