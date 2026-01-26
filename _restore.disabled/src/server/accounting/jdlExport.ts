import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type JdlExportFile = {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: string;
};

export async function ensureJdlExportDir(): Promise<string> {
  const configured = process.env.JDL_EXPORT_DIR?.trim();
  const dir = configured && configured.length > 0 ? configured : 'exports/jdl';
  const resolved = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  await mkdir(resolved, { recursive: true });
  return resolved;
}

export function resolveJdlExportFilePath(exportDir: string, fileName: string): string {
  // Prevent path traversal by forcing basename.
  const safeName = path.basename(fileName);
  return path.join(exportDir, safeName);
}

export async function listJdlExportFiles(exportDir: string, limit = 50): Promise<JdlExportFile[]> {
  const names = await readdir(exportDir, { withFileTypes: true });
  const csvNames = names
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.csv'))
    .map((d) => d.name);

  const files: JdlExportFile[] = [];
  for (const fileName of csvNames) {
    const filePath = path.join(exportDir, fileName);
    const s = await stat(filePath);
    files.push({
      fileName,
      filePath,
      sizeBytes: s.size,
      modifiedAt: s.mtime.toISOString(),
    });
  }

  files.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
  return files.slice(0, limit);
}
