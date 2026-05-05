import type { LoginDeviceContext } from '@/server/auth/login-memory';
import { prisma } from '@/server/db/prisma';

function normalize(value: string | null | undefined) {
  return (value ?? '').trim();
}

function firstLanguage(value: string | null | undefined) {
  return normalize(value).split(',')[0]?.trim() ?? '';
}

export async function createUserLoginNotification(
  request: Request,
  userId: string,
  device?: LoginDeviceContext | null,
) {
  const host = normalize(device?.host) || normalize(request.headers.get('host'));
  const platform = normalize(device?.platform) || normalize(request.headers.get('user-agent'));
  const language = normalize(device?.language) || firstLanguage(request.headers.get('accept-language'));
  const timeZone = normalize(device?.timeZone);

  const summary = [host, platform, language, timeZone].filter(Boolean).join(' / ');

  await prisma.userNotification.create({
    data: {
      userId,
      kind: 'LOGIN',
      title: '新しいログインがありました',
      body: summary || null,
      metadata: {
        host: host || null,
        platform: platform || null,
        language: language || null,
        timeZone: timeZone || null,
        occurredAt: new Date().toISOString(),
      },
    },
  });
}