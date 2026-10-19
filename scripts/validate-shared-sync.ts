import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

type SharedSyncPreviewResult = {
  warnings: string[];
};

type SharedSyncRunResult = {
  warnings: string[];
  counts: Record<string, number>;
};

type SharedSyncModule = {
  getSharedSyncPreview(input: { kind: 'NORMAL' | 'DAILY' }): Promise<SharedSyncPreviewResult>;
  runSharedSync(input: { kind: 'NORMAL' | 'DAILY' }): Promise<SharedSyncRunResult>;
};

async function main() {
  const mod = await import('../src/server/shared-excel-sync');
  const api = ((mod as unknown as { default?: SharedSyncModule }).default ?? (mod as unknown as SharedSyncModule));

  console.log('[validate-shared-sync] preview:start');
  const preview = await api.getSharedSyncPreview({ kind: 'NORMAL' });
  console.log('[validate-shared-sync] preview:done');
  console.log(JSON.stringify(preview, null, 2));

  console.log('[validate-shared-sync] sync1:start');
  const first = await api.runSharedSync({ kind: 'NORMAL' });
  console.log('[validate-shared-sync] sync1:done');
  console.log(
    JSON.stringify(
      {
        warnings: first.warnings,
        counts: first.counts,
      },
      null,
      2,
    ),
  );

  console.log('[validate-shared-sync] sync2:start');
  const second = await api.runSharedSync({ kind: 'NORMAL' });
  console.log('[validate-shared-sync] sync2:done');
  console.log(
    JSON.stringify(
      {
        warnings: second.warnings,
        counts: second.counts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[validate-shared-sync] failed');
  console.error(error);
  process.exit(1);
});