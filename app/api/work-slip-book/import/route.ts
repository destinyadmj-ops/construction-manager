import { gunzipLimited } from '@/server/gzip-body';
import { getSharedWorkSlipFile } from '@/server/shared-excel-sync';
import { getCurrentMeta, readVersion, saveVersion, snapshotFromExcelBuffer, snapshotFromExcelFile, WorkSlipBookConflictError } from '@/server/work-slip-book';
import { guardWorkSlipBook } from '@/server/work-slip-book-auth';
import { reflectBookToLedgerInBackground } from '@/server/work-slip-book-reflect';
import { mergeImportedValues } from '@/shared/work-slip-book-convert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// file なし: 共有フォルダの作業伝票から取り込み(一方向)。file あり: アップロードした Excel から取り込み。
// ブックが既にある場合はセルの内容だけを反映し(列幅・行高・書式は維持)、初回のみ書式つきで全体を作る。いずれも新しい版として保存する。
export async function POST(request: Request) {
  const guard = await guardWorkSlipBook(request);
  if (guard.response) return guard.response;

  try {
    let snapshot;
    let source: 'import' | 'upload';
    let sourceFileName: string;

    const type = request.headers.get('content-type') ?? '';
    if (type.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: 'file is required' }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) return Response.json({ ok: false, error: 'File too large' }, { status: 413 });
      if (!/\.(xlsx|xls)$/i.test(file.name)) return Response.json({ ok: false, error: 'Only .xlsx/.xls' }, { status: 400 });
      const bytes = Buffer.from(await file.arrayBuffer());
      snapshot = snapshotFromExcelBuffer(form.get('encoding') === 'gzip' ? gunzipLimited(bytes) : bytes);
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

    const meta = await getCurrentMeta();
    const base = meta ? await readVersion(meta.version) : null;
    const saved = await saveVersion({
      snapshot: base ? mergeImportedValues(base, snapshot) : snapshot,
      baseVersion: base && meta ? meta.version : null,
      user: guard.user,
      source,
      sourceFileName,
    });
    reflectBookToLedgerInBackground();
    return Response.json({ ok: true, meta: saved });
  } catch (error) {
    if (error instanceof WorkSlipBookConflictError) {
      return Response.json({ ok: false, error: '他の人が先に保存しました。画面を読み込み直してからやり直してください。', currentVersion: error.currentVersion }, { status: 409 });
    }
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Import failed' }, { status: 400 });
  }
}
