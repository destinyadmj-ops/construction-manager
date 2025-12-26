import { generateSimplePdf } from '@/server/templates/simplePdf';

export const runtime = 'nodejs';

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | null {
  return v && typeof v === 'object' ? (v as JsonObject) : null;
}

function getField(obj: unknown, key: string): unknown {
  const o = asObject(obj);
  return o ? o[key] : undefined;
}

function getStringField(obj: unknown, key: string): string | null {
  const v = getField(obj, key);
  return typeof v === 'string' ? v : null;
}

function safeString(v: unknown, fallback: string) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const kindRaw = safeString(getStringField(json, 'kind'), 'invoice');
    const kind = kindRaw === 'report' ? 'report' : 'invoice';
    const title = safeString(getStringField(json, 'title'), kind === 'report' ? '報告書' : '請求書');
    const subtitle = safeString(getStringField(json, 'subtitle'), 'Master Hub');

    const linesVal = getField(json, 'lines');
    const linesRaw = Array.isArray(linesVal) ? linesVal : [];
    const lines = linesRaw
      .map((x: unknown) => (typeof x === 'string' ? x : ''))
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)
      .slice(0, 60);

    const { bytes, filename, contentType } = await generateSimplePdf({ kind, title, subtitle, lines });
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const body = new Blob([ab], { type: 'application/pdf' });

    return new Response(body, {
      headers: {
        'content-type': contentType,
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'PDF generation failed';
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
