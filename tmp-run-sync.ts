import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

async function main() {
  const { runSharedSync } = await import('@/server/shared-excel-sync');
  const result = await runSharedSync({ kind: 'NORMAL' });
  console.log(JSON.stringify({ warnings: result.warnings, counts: result.counts }, null, 2));
  const { prisma } = await import('@/server/db/prisma');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
