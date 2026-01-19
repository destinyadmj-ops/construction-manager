export async function GET() {
  return Response.json({
    ok: true,
    service: 'master-hub',
    now: new Date().toISOString(),
  });
}
