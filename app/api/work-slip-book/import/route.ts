import { getSharedWorkSlipFile } from '@/server/shared-excel-sync';
import { saveVersion, snapshotFromExcelBuffer, snapshotFromExcelFile } from '@/server/work-slip-book';
import { guardWorkSlipBook } from '@/server/work-slip-book-auth';
import { reflectBookToLedgerInBackground } from '@/server/work-slip-book-reflect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// file なし: 共有フォルダの作業伝票から取り込み(一方向)。file あり: アップロードした Excel で置き換え。いずれも新しい版として保存する。
export async function POST(request: Request) {
  const guard = await guardWorkSlipBook(request);
  if (guard.response) return guard.response;

  try {
    let snapshot;
    let source: 'import' | 'upload';
    let sourceFileName: string;

    const type = request.headers.get('content-type') ?? '';
    if (type.includes('multipart/form-data')) {
      const file = (await request.formData()).get('file');
      if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: 'file is required' }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) return Response.json({ ok: false, error: 'File too large' }, { status: 413 });
      if (!/\.(xlsx|xls)$/i.test(file.name)) return Response.json({ ok: false, error: 'Only .xlsx/.xls' }, { status: 400 });
      snapshot = snapshotFromExcelBuffer(Buffer.from(await file.arrayBuffer()));
      source = 'upload';
      sourceFileName = file.name;
    } else {
      const shared = await getSharedWorkSlipFile().catch(() => null);
      if (!shared) {
        return Response.json(
          { ok: false, error: 'このサーバーから共有フォルダの作業伝票が見つかりません（本番ホストに共有フォルダがマウントされていない可能性）。「Excelで置き換え」でファイルを選んでください。' },
          { status: 404 },
        );
      }
      snapshot = snapshotFromExcelFile(shared.filePath);
      source = 'import';
      sourceFileName = shared.fileName;
    }

    const meta = await saveVersion({ snapshot, baseVersion: null, user: guard.user, source, sourceFileName });
    reflectBookToLedgerInBackground();
    return Response.json({ ok: true, meta });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Import failed' }, { status: 400 });
  }
}
