// 前段プロキシの本文上限(約1MB)を超えないよう、送信前にブラウザ側で gzip 圧縮する。非対応環境は元データを返す。
export async function gzipIfSupported(data: Blob): Promise<{ blob: Blob; gzipped: boolean }> {
  if (typeof CompressionStream === 'undefined') return { blob: data, gzipped: false };
  const stream = data.stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(stream).blob(), gzipped: true };
}
