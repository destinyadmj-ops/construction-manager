import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { getBundledDesktopInstaller } from '@/server/desktop-release';

export const runtime = 'nodejs';

export async function GET() {
  const installer = getBundledDesktopInstaller();
  if (!installer) {
    return NextResponse.json(
      { ok: false, error: 'Desktop installer not found' },
      {
        status: 404,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      },
    );
  }

  const stream = createReadStream(installer.filePath);
  const body = Readable.toWeb(stream) as ReadableStream;

  return new Response(body, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${installer.fileName}"`,
    },
  });
}