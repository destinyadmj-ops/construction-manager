import { prisma } from '@/server/db/prisma';
import { z } from 'zod';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

const QuerySchema = z
  .object({
    kind: z.enum(['normal', 'daily']).optional(),
  })
  .passthrough();

function normalizeSiteName(input: string) {
  const s = (input ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    // normalize dash/minus variants (keep Japanese long vowel mark 'ー' as-is)
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function looksLikeHeader(v: string) {
  const s = v.trim();
  if (!s) return true;
  const banned = new Set([
    '月',
    '火',
    '水',
    '木',
    '金',
    '土',
    '日',
    '曜日',
    '日付',
    '日程',
    '予定',
    '担当',
    '氏名',
    '名前',
    'AM',
    'PM',
    '午前',
    '午後',
    '休',
    '休み',
    '休日',
    '備考',
    'メモ',
  ]);
  if (banned.has(s)) return true;
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(s)) return true;
  if (/^\d{1,2}[:：]\d{2}/.test(s)) return true;
  if (/^\d+$/.test(s)) return true;
  return false;
}

function extractNamesFromGrid(grid: unknown[][]) {
  const names: string[] = [];

  // Try to locate a column whose header contains "現場".
  const headerRows = Math.min(20, grid.length);
  let bestCol: number | null = null;
  let bestScore = 0;

  for (let r = 0; r < headerRows; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const raw = row[c];
      const v = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
      const s = normalizeSiteName(v);
      if (!s) continue;
      if (s === '現場' || s === '現場名' || s === '現場名称' || s.includes('現場')) {
        // Score: earlier row + exact match
        const score = (s === '現場' || s === '現場名' ? 5 : 3) + (20 - r);
        if (score > bestScore) {
          bestScore = score;
          bestCol = c;
        }
      }
    }
  }

  if (bestCol != null) {
    let emptyRun = 0;
    for (let r = 0; r < grid.length; r++) {
      const raw = bestCol < (grid[r]?.length ?? 0) ? grid[r]![bestCol] : '';
      const s = normalizeSiteName(typeof raw === 'string' ? raw : raw == null ? '' : String(raw));
      if (!s || looksLikeHeader(s)) {
        emptyRun++;
        if (emptyRun >= 10 && r > 10) break;
        continue;
      }
      emptyRun = 0;
      names.push(s);
    }
  }

  // Fallback: scan all cells.
  if (names.length === 0) {
    for (const row of grid) {
      for (const cell of row ?? []) {
        const s = normalizeSiteName(typeof cell === 'string' ? cell : cell == null ? '' : String(cell));
        if (!s || looksLikeHeader(s)) continue;
        if (s.length < 2 || s.length > 80) continue;
        names.push(s);
      }
    }
  }

  // Normalize + unique preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const x = normalizeSiteName(n);
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsedQuery = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  const kind = parsedQuery.success && parsedQuery.data.kind === 'daily' ? 'DAILY' : 'NORMAL';

  const form = await request.formData().catch(() => null);
  if (!form) {
    return Response.json({ ok: false, error: 'Invalid form' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'file is required' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let names: string[] = [];
  try {
    const wb = XLSX.read(buf, { type: 'buffer' });
    for (const sheetName of wb.SheetNames ?? []) {
      const sheet = wb.Sheets?.[sheetName];
      if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false }) as unknown[][];
      const extracted = extractNamesFromGrid(grid);
      for (const n of extracted) names.push(n);
      if (names.length >= 2000) break;
    }
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to parse Excel' },
      { status: 400 },
    );
  }

  // Unique again across sheets
  const seen = new Set<string>();
  const normalizedNames: string[] = [];
  for (const n of names) {
    const x = normalizeSiteName(n);
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    normalizedNames.push(x);
  }
  names = normalizedNames;

  if (names.length === 0) {
    return Response.json({ ok: true, created: 0, skipped: 0, total: 0, names: [] });
  }

  // Avoid duplicates within kind by normalized name comparison.
  // (DB does not enforce uniqueness, so we do best-effort skip here.)
  const existingNormalizedSet = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const args: Parameters<typeof prisma.site.findMany>[0] = {
      where: { kind },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 2000,
    };
    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    const batch = await prisma.site.findMany(args);
    for (const s of batch) existingNormalizedSet.add(normalizeSiteName(s.name));
    if (batch.length < 2000) break;
    cursor = batch[batch.length - 1]!.id;
  }

  const toCreate: string[] = [];
  for (const n of names) {
    const x = normalizeSiteName(n);
    if (!x) continue;
    if (existingNormalizedSet.has(x)) continue;
    existingNormalizedSet.add(x);
    toCreate.push(x);
  }

  let created = 0;
  if (toCreate.length > 0) {
    // Create individually to avoid partial failure hiding.
    for (const name of toCreate) {
      await prisma.site.create({ data: { name, kind }, select: { id: true } });
      created++;
    }
  }

  const skipped = names.length - created;

  return Response.json({
    ok: true,
    kind,
    created,
    skipped,
    total: names.length,
    names: names.slice(0, 200),
  });
}
