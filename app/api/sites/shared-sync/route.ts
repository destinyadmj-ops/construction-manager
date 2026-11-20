import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { SharedSyncError, getSharedSyncPreview, runSharedSync } from '@/server/shared-excel-sync';
import { readSharedPollerTicks, readSharedSyncStatuses } from '@/server/shared-sync-status';
import { readAgentContact, readUploadMeta } from '@/server/shared-upload';
import { evaluateSharedSyncHealth } from '@/shared/shared-sync-health';
import { evaluateUploadHealth } from '@/shared/shared-sync-upload';
import { z } from 'zod';

export const runtime = 'nodejs';

const QuerySchema = z
  .object({
    kind: z.enum(['normal', 'daily']).optional(),
    targetTerm: z
      .string()
      .regex(/^\d+$/)
      .optional(),
  })
  .passthrough();

const BodySchema = z
  .object({
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
    targetTerm: z.number().int().positive().optional().nullable(),
  })
  .strict();

function toKindFromQuery(kind: string | undefined): 'NORMAL' | 'DAILY' {
  return kind === 'daily' ? 'DAILY' : 'NORMAL';
}

function toTargetTerm(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export async function GET(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const query = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    const kind = toKindFromQuery(query.success ? query.data.kind : undefined);
    const targetTerm = toTargetTerm(query.success ? query.data.targetTerm : undefined);

    const preview = await getSharedSyncPreview({ kind, targetTerm });
    const [status, poller, uploadMeta, agentContact] = await Promise.all([
      readSharedSyncStatuses(kind),
      readSharedPollerTicks(kind),
      readUploadMeta(),
      readAgentContact(),
    ]);
    const nowMs = Date.now();
    const health = {
      schedule: evaluateSharedSyncHealth({ scope: 'schedule', run: status.schedule, poller: poller.schedule, nowMs }),
      ledger: evaluateSharedSyncHealth({ scope: 'ledger', run: status.ledger, poller: poller.ledger, nowMs }),
    };
    // 会社PCからの送信方式を使っている環境(受け口のトークン設定あり/受信実績あり)だけで表示する
    const uploadEnabled = !!(process.env.SHARED_SYNC_UPLOAD_TOKEN ?? '').trim() || !!uploadMeta;
    const upload = uploadEnabled
      ? {
          meta: uploadMeta ? { fileName: uploadMeta.fileName, receivedAt: uploadMeta.receivedAt, via: uploadMeta.via, sizeBytes: uploadMeta.sizeBytes } : null,
          lastContactAt: agentContact?.lastContactAt ?? null,
          health: evaluateUploadHealth({ meta: uploadMeta, contact: agentContact, nowMs }),
        }
      : null;
    return Response.json({ ...preview, status, poller, health, upload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '共有フォルダの確認に失敗しました';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  try {
    const bodyRaw = await request.json().catch(() => null);
    const body = BodySchema.safeParse(bodyRaw ?? {});
    if (!body.success) {
      return Response.json({ ok: false, error: 'Invalid body', issues: body.error.issues }, { status: 400 });
    }

    const kind = body.data.kind ?? 'NORMAL';
    const targetTerm = body.data.targetTerm ?? null;

    const result = await runSharedSync({ kind, targetTerm });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SharedSyncError) {
      const status = error.code === 'MISSING_SOURCE' ? 400 : error.code === 'PASSWORD_PROTECTED' ? 422 : error.code === 'BUSY' ? 409 : 500;
      return Response.json({ ok: false, error: error.message, code: error.code }, { status });
    }
    const message = error instanceof Error ? error.message : '共有フォルダ同期に失敗しました';
    return Response.json({ ok: false, error: message, code: 'SYNC_FAILED' }, { status: 500 });
  }
}
