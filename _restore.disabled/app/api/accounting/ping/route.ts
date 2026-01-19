import { getAccountingProvider } from '@/server/accounting';

export async function GET() {
  const provider = getAccountingProvider();
  const result = await provider.ping();

  if (!result.ok) {
    return Response.json({ ok: false, provider: provider.key, error: result.error }, { status: 500 });
  }

  return Response.json({ ok: true, provider: provider.key });
}
