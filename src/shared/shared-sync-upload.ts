// 会社PCから送られてくる原本(作業表☆)の検証と、送信が止まっていないかの判定(web/worker/テスト共通の純粋関数)。
export const UPLOAD_MAX_BYTES_DEFAULT = 25 * 1024 * 1024;
export const WORK_TABLE_NAME_KEY = '作業表☆';
export const AGENT_SILENT_MS = 45 * 60_000;

export type UploadMeta = {
  sha256: string;
  fileName: string;
  sizeBytes: number;
  /** 原本ファイルの更新日時(ms)。年なし日付の年補完の基準になる */
  sourceMtimeMs: number;
  receivedAt: string;
  via: 'agent' | 'manual';
};

export type AgentContact = { lastContactAt: string; host?: string | null };

export type UploadCheck = { ok: true } | { ok: false; status: 400 | 413 | 415; error: string };

export function validateUploadFileName(fileName: string): UploadCheck {
  const name = fileName.normalize('NFKC').trim();
  if (!name || name.length > 200 || /[\\/\u0000-\u001f]/.test(name)) return { ok: false, status: 400, error: 'ファイル名が不正です' };
  const lower = name.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) return { ok: false, status: 415, error: 'Excel(.xlsx/.xls)以外は受け付けません' };
  if (!name.startsWith(WORK_TABLE_NAME_KEY)) return { ok: false, status: 400, error: `ファイル名が「${WORK_TABLE_NAME_KEY}」で始まる原本のみ受け付けます` };
  return { ok: true };
}

export function validateUploadBytes(bytes: Uint8Array, maxBytes: number): UploadCheck {
  if (bytes.length === 0) return { ok: false, status: 400, error: 'ファイルが空です' };
  if (bytes.length > maxBytes) return { ok: false, status: 413, error: `ファイルが大きすぎます(上限 ${Math.floor(maxBytes / 1024 / 1024)}MB)` };
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isOle = bytes.length > 8 && ole.every((b, i) => bytes[i] === b);
  if (!isZip && !isOle) return { ok: false, status: 415, error: 'Excel ファイルの形式ではありません' };
  return { ok: true };
}

export function extensionOfUpload(fileName: string): '.xlsx' | '.xls' {
  return fileName.toLowerCase().endsWith('.xls') ? '.xls' : '.xlsx';
}

// 稼働時間(日本時間・月〜土 7:00〜20:00)。この間だけ「送信が無い」を警告する。
export function isUploadBusinessHours(nowMs: number): boolean {
  const jst = new Date(nowMs + 9 * 3_600_000);
  const day = jst.getUTCDay();
  const hour = jst.getUTCHours();
  return day >= 1 && day <= 6 && hour >= 7 && hour < 20;
}

export function evaluateUploadHealth(input: {
  meta: UploadMeta | null;
  contact: AgentContact | null;
  nowMs: number;
}): { level: 'ok' | 'warn'; reasons: string[] } {
  const { meta, contact, nowMs } = input;
  if (!meta && !contact) return { level: 'warn', reasons: ['会社PCから原本(作業表☆)を一度も受信していません(会社PCの送信ツールを確認してください)'] };
  const times = [contact?.lastContactAt, meta?.receivedAt].map((iso) => (iso ? new Date(iso).getTime() : Number.NaN)).filter((t) => !Number.isNaN(t));
  const lastSignal = times.length > 0 ? Math.max(...times) : null;
  const silentMs = lastSignal == null ? Number.POSITIVE_INFINITY : nowMs - lastSignal;
  if (silentMs > AGENT_SILENT_MS && isUploadBusinessHours(nowMs)) {
    const minutes = Number.isFinite(silentMs) ? `${Math.floor(silentMs / 60_000)} 分間` : '長い間';
    return {
      level: 'warn',
      reasons: [`会社PCからの連絡が ${minutes} ありません(PC停止・スリープ・ネットワークを確認。急ぎなら「原本を手動アップロード」を使えます)`],
    };
  }
  return { level: 'ok', reasons: [] };
}
