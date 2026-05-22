import { NextRequest, NextResponse } from 'next/server';

// 簡易メモリストア（本番はDBやRedis等に置換）
const colorState: { [id: string]: string } = {};

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  return NextResponse.json({ ok: true, color: colorState[id] || '#38bdf8' });
}

export async function POST(req: NextRequest) {
  const { id, color } = await req.json();
  if (!id || typeof color !== 'string') return NextResponse.json({ ok: false, error: 'id and color required' }, { status: 400 });
  colorState[id] = color;
  return NextResponse.json({ ok: true });
}
