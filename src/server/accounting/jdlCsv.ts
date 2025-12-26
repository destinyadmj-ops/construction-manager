import type { WorkEntryForAccounting } from './types';

type BuildJdlCsvOptions = {
  metaKeys?: string[];
  columns?: string[];
};

const BASE_COLUMNS = [
  'id',
  'date',
  'startAt',
  'endAt',
  'amount',
  'taxCategory',
  'summary',
  'department',
  'accountingType',
  'note',
] as const;

export function buildJdlCsv(entries: WorkEntryForAccounting[], options: BuildJdlCsvOptions = {}): string {
  const metaKeys = normalizeMetaKeys(options.metaKeys ?? []);
  const columns = normalizeColumns(options.columns);

  const header = [...columns, ...metaKeys.map((k) => `meta.${k}`)];

  const lines = [
    header.join(','),
    ...entries.map((e) => {
      const summary = (e.summary ?? e.note ?? '').toString();
      const date = e.startAt.toISOString().slice(0, 10);
      const amount = normalizeAmount(e.amount);

      const metaValues = metaKeys.map((k) => extractMetaValue(e.accountingMeta, k));

      const baseValues = columns.map((c) => {
        switch (c) {
          case 'id':
            return csvCell(e.id);
          case 'date':
            return csvCell(date);
          case 'startAt':
            return csvCell(e.startAt.toISOString());
          case 'endAt':
            return csvCell(e.endAt ? e.endAt.toISOString() : '');
          case 'amount':
            return csvCell(amount);
          case 'taxCategory':
            return csvCell((e.taxCategory ?? '').toString());
          case 'summary':
            return csvCell(summary);
          case 'department':
            return csvCell((e.department ?? '').toString());
          case 'accountingType':
            return csvCell((e.accountingType ?? '').toString());
          case 'note':
            return csvCell((e.note ?? '').toString());
          default:
            return csvCell('');
        }
      });

      return [...baseValues, ...metaValues.map(csvCell)].join(',');
    }),
  ];

  return `${lines.join('\n')}\n`;
}

function normalizeMetaKeys(metaKeys: string[]): string[] {
  const cleaned = metaKeys
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .filter((k) => !k.includes(','))
    .slice(0, 50);
  return Array.from(new Set(cleaned));
}

function normalizeColumns(columns: string[] | undefined): string[] {
  if (!columns || columns.length === 0) return [...BASE_COLUMNS];

  const allowed = new Set<string>(BASE_COLUMNS);
  const cleaned = columns
    .map((c) => String(c).trim())
    .filter((c) => c.length > 0)
    .filter((c) => allowed.has(c))
    .slice(0, BASE_COLUMNS.length);
  const uniq = Array.from(new Set(cleaned));
  return uniq.length > 0 ? uniq : [...BASE_COLUMNS];
}

function extractMetaValue(meta: unknown, key: string): string {
  if (!meta || typeof meta !== 'object') return '';
  const record = meta as Record<string, unknown>;
  const value = record[key];
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function normalizeAmount(amount: unknown): string {
  if (amount === null || amount === undefined) return '';
  if (typeof amount === 'number') return Number.isFinite(amount) ? String(amount) : '';
  if (typeof amount === 'string') return amount;
  try {
    return String(amount);
  } catch {
    return '';
  }
}

function csvCell(value: string): string {
  const needsQuote = /[",\n\r]/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
