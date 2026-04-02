import { createHash } from 'crypto';

import { prisma } from '@/server/db/prisma';

export type LoginDeviceContext = {
  deviceKey: string;
  host?: string;
  platform?: string;
  language?: string;
  timeZone?: string;
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: string | null | undefined) {
  return (value ?? '').trim();
}

function getRequestIp(request: Request) {
  const forwarded = normalize(request.headers.get('x-forwarded-for'));
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? '';
  return normalize(request.headers.get('x-real-ip'));
}

function getRequestUserAgent(request: Request) {
  return normalize(request.headers.get('user-agent'));
}

export async function rememberUserLoginDevice(request: Request, userId: string, device?: LoginDeviceContext | null) {
  const deviceKey = normalize(device?.deviceKey);
  if (!deviceKey) return;

  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);
  const fingerprintHash = sha256(deviceKey);

  await prisma.userLoginMemory.upsert({
    where: { fingerprintHash },
    update: {
      userId,
      host: normalize(device?.host),
      platform: normalize(device?.platform),
      language: normalize(device?.language),
      timeZone: normalize(device?.timeZone),
      ipHash: ip ? sha256(ip) : null,
      userAgentHash: userAgent ? sha256(userAgent) : null,
      lastSeenAt: new Date(),
    },
    create: {
      userId,
      fingerprintHash,
      host: normalize(device?.host),
      platform: normalize(device?.platform),
      language: normalize(device?.language),
      timeZone: normalize(device?.timeZone),
      ipHash: ip ? sha256(ip) : null,
      userAgentHash: userAgent ? sha256(userAgent) : null,
      lastSeenAt: new Date(),
    },
  });
}

export async function canRestoreUserLogin(request: Request, userId: string, device?: LoginDeviceContext | null) {
  const deviceKey = normalize(device?.deviceKey);
  if (!deviceKey) return false;

  const fingerprintHash = sha256(deviceKey);
  const hit = await prisma.userLoginMemory.findUnique({
    where: { fingerprintHash },
    select: {
      userId: true,
      host: true,
      platform: true,
      language: true,
      timeZone: true,
      userAgentHash: true,
    },
  });

  if (!hit || hit.userId !== userId) return false;
  if (normalize(device?.host) !== hit.host) return false;
  if (normalize(device?.platform) !== hit.platform) return false;
  if (normalize(device?.language) !== hit.language) return false;
  if (normalize(device?.timeZone) !== hit.timeZone) return false;

  const userAgent = getRequestUserAgent(request);
  if (hit.userAgentHash && sha256(userAgent) !== hit.userAgentHash) return false;

  await rememberUserLoginDevice(request, userId, device);
  return true;
}