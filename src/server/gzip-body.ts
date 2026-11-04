import { gunzipSync } from 'node:zlib';

const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

// 圧縮爆弾対策として展開後サイズに上限を設ける。
export function gunzipLimited(buf: Buffer): Buffer {
  return gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
}
