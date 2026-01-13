export const runtime = 'nodejs';

function parseFingerprints(raw: string): string[] {
  return raw
    .split(/[\s,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toUpperCase())
    .filter((s) => /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(s));
}

export async function GET() {
  const pkg = (process.env.TWA_ASSETLINKS_PACKAGE_NAME ?? '').trim();
  const fpsRaw = (process.env.TWA_ASSETLINKS_SHA256_CERT_FINGERPRINTS ?? '').trim();
  const fingerprints = fpsRaw ? parseFingerprints(fpsRaw) : [];

  if (!pkg || fingerprints.length === 0) {
    return new Response('assetlinks.json is not configured', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
