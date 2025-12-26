import { getAccountingProvider } from '@/server/accounting';
import { prisma } from '@/server/db/prisma';
import { buildJdlCsv } from '@/server/accounting/jdlCsv';
import { Prisma } from '@/generated/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const AccountingTypeSchema = z.enum(['EXPENSE', 'LABOR', 'ACCOUNTS_RECEIVABLE']);

const CsvColumnSchema = z.enum([
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
]);

const BodySchema = z
  .object({
    since: z.string().datetime().optional().nullable(),
    until: z.string().datetime().optional().nullable(),

    userId: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    taxCategory: z.string().optional().nullable(),
    accountingType: AccountingTypeSchema.optional().nullable(),

    minAmount: z.number().optional().nullable(),
    maxAmount: z.number().optional().nullable(),

    text: z.string().optional().nullable(),
    textMode: z.enum(['note', 'summary', 'both']).optional().nullable(),

    limit: z.number().int().min(1).max(10_000).optional().nullable(),

    // Select base CSV columns. If omitted or empty, exports all base columns.
    columns: z.array(CsvColumnSchema).max(20).optional().nullable(),

    metaKeys: z.array(z.string()).max(50).optional().nullable(),

    // Filter by accountingMeta JSON keys.
    // Example: { metaEquals: { project: 'A', 'client.code': 'C001' } }
    metaEquals: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .nullable(),
  })
  .strict();

export async function POST(request: Request) {
  const provider = getAccountingProvider();
  if (provider.key !== 'jdl') {
    return Response.json({ ok: false, error: 'export endpoint currently supports jdl provider only' }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    since,
    until,
    userId,
    department,
    taxCategory,
    accountingType,
    minAmount,
    maxAmount,
    text,
    textMode,
    limit,
    columns,
    metaKeys,
    metaEquals,
  } = parsed.data;

  const where: Prisma.WorkEntryWhereInput = {
    ...(since ? { startAt: { gte: new Date(since) } } : {}),
    ...(until ? { startAt: { lt: new Date(until) } } : {}),
    ...(userId ? { userId } : {}),
    ...(department ? { department } : {}),
    ...(taxCategory ? { taxCategory } : {}),
    ...(accountingType ? { accountingType } : {}),
  };

  if (typeof minAmount === 'number' || typeof maxAmount === 'number') {
    const amountFilter: Prisma.DecimalNullableFilter<'WorkEntry'> = {};
    if (typeof minAmount === 'number') amountFilter.gte = String(minAmount);
    if (typeof maxAmount === 'number') amountFilter.lte = String(maxAmount);
    where.amount = amountFilter;
  }

  const normalizedText = (text ?? '').trim();
  const mode = textMode ?? 'both';
  if (normalizedText.length > 0) {
    const contains: Prisma.StringNullableFilter<'WorkEntry'> = {
      contains: normalizedText,
      mode: 'insensitive',
    };
    if (mode === 'note') {
      where.note = contains;
    } else if (mode === 'summary') {
      where.summary = contains;
    } else {
      where.OR = [{ note: contains }, { summary: contains }];
    }
  }

  const metaEqualsEntries = Object.entries(metaEquals ?? {})
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0)
    .slice(0, 50);

  if (metaEqualsEntries.length > 0) {
    const metaWheres: Prisma.WorkEntryWhereInput[] = metaEqualsEntries.map(
      ([key, value]) => {
        const path = key
          .split('.')
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0)
          .slice(0, 10);

        const equalsValue:
          | Prisma.InputJsonValue
          | Prisma.JsonNullValueFilter =
          value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

        const jsonFilter: Prisma.JsonNullableFilter<'WorkEntry'> = {
          path,
          equals: equalsValue,
        };

        return { accountingMeta: jsonFilter };
      },
    );

    const andExisting = Array.isArray(where.AND)
      ? where.AND
      : where.AND
        ? [where.AND]
        : [];
    where.AND = [...andExisting, ...metaWheres];
  }

  const entries = await prisma.workEntry.findMany({
    where,
    orderBy: { startAt: 'asc' },
    take: limit ?? 10_000,
    select: {
      id: true,
      startAt: true,
      endAt: true,
      note: true,
      amount: true,
      taxCategory: true,
      summary: true,
      department: true,
      accountingType: true,
      accountingMeta: true,
    },
  });

  const csv = buildJdlCsv(entries, { metaKeys: metaKeys ?? [], columns: columns ?? undefined });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="accounting_export_${stamp}.csv"`,
    },
  });
}
