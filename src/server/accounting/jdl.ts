import type { AccountingProvider, AccountingSyncOptions, AccountingSyncResult, WorkEntryForAccounting } from './types';

import { access, writeFile, rename } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { ensureJdlExportDir } from './jdlExport';
import { buildJdlCsv } from './jdlCsv';

export class JdlProvider implements AccountingProvider {
  key = 'jdl' as const;

  async ping() {
    try {
      const exportDir = await ensureJdlExportDir();
      await access(exportDir, fsConstants.W_OK);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'JDL export dir not writable' };
    }
  }

  async syncWorkEntries(entries: WorkEntryForAccounting[], options?: AccountingSyncOptions): Promise<AccountingSyncResult> {
    try {
      const exportDir = await ensureJdlExportDir();
      await access(exportDir, fsConstants.W_OK);

      const csv = buildJdlCsv(entries, { metaKeys: options?.metaKeys ?? [] });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `work_entries_${stamp}.csv`;
      const filePath = path.join(exportDir, fileName);
      const tmpPath = `${filePath}.tmp`;

      await writeFile(tmpPath, csv, 'utf8');
      await rename(tmpPath, filePath);

      return {
        ok: true,
        message: `exported ${entries.length} entries` ,
        details: {
          provider: this.key,
          exportDir,
          fileName,
          filePath,
          count: entries.length,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'JDL export failed' };
    }
  }
}
