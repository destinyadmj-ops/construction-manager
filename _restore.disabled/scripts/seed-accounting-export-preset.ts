import { PrismaClient } from '@/generated/prisma';

const prisma = new PrismaClient();

async function main() {
  const presets = [
    {
      key: 'default',
      name: 'Default Accounting CSV Export',
      body: { metaKeys: ['project'] },
    },
    {
      key: 'expense',
      name: 'Expense CSV Export',
      body: { accountingType: 'EXPENSE', metaKeys: ['project'] },
    },
    {
      key: 'labor',
      name: 'Labor CSV Export',
      body: { accountingType: 'LABOR', metaKeys: ['project'] },
    },
    {
      key: 'ar',
      name: 'Accounts Receivable CSV Export',
      body: { accountingType: 'ACCOUNTS_RECEIVABLE', metaKeys: ['project'] },
    },
  ] as const;

  const results = [] as Array<{ id: string; key: string; updatedAt: Date }>;
  for (const p of presets) {
    const preset = await prisma.accountingExportPreset.upsert({
      where: { key: p.key },
      create: { key: p.key, name: p.name, body: p.body },
      update: { name: p.name, body: p.body },
      select: { id: true, key: true, updatedAt: true },
    });
    results.push(preset);
  }

  console.log('Seeded AccountingExportPreset:', results);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
