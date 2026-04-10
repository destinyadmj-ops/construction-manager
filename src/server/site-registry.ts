import { prisma } from '@/server/db/prisma';

export type RegistrySiteKind = 'NORMAL' | 'DAILY';

type SiteCandidate = {
  id: string;
  name: string;
  companyName: string | null;
};

type PartnerCandidate = {
  id: string;
  name: string;
};

export function normalizeRegistryText(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeOptionalRegistryText(input: string | null | undefined): string | null {
  const normalized = normalizeRegistryText(input);
  return normalized || null;
}

function normalizeRegistryKey(input: string | null | undefined): string {
  return normalizeRegistryText(input).replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
}

async function listSiteCandidates(kind: RegistrySiteKind, excludeId?: string): Promise<SiteCandidate[]> {
  const items: SiteCandidate[] = [];
  let cursor: string | null = null;

  for (;;) {
    const args: Parameters<typeof prisma.site.findMany>[0] = {
      where: { kind, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true, companyName: true },
      orderBy: { id: 'asc' },
      take: 1000,
    };

    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    const batch = await prisma.site.findMany(args);
    items.push(...batch);
    if (batch.length < 1000) break;
    cursor = batch[batch.length - 1]?.id ?? null;
    if (!cursor) break;
  }

  return items;
}

async function listPartnerCandidates(excludeId?: string): Promise<PartnerCandidate[]> {
  const items: PartnerCandidate[] = [];
  let cursor: string | null = null;

  for (;;) {
    const args: Parameters<typeof prisma.partner.findMany>[0] = {
      where: excludeId ? { id: { not: excludeId } } : undefined,
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 1000,
    };

    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    const batch = await prisma.partner.findMany(args);
    items.push(...batch);
    if (batch.length < 1000) break;
    cursor = batch[batch.length - 1]?.id ?? null;
    if (!cursor) break;
  }

  return items;
}

export async function findMatchingSite(input: {
  companyName?: string | null;
  name: string;
  kind: RegistrySiteKind;
  excludeId?: string;
}): Promise<{ site: SiteCandidate | null; matchType: 'exact' | 'name-only' | null }> {
  const nameKey = normalizeRegistryKey(input.name);
  if (!nameKey) return { site: null, matchType: null };

  const companyKey = normalizeRegistryKey(input.companyName);
  const candidates = (await listSiteCandidates(input.kind, input.excludeId)).filter(
    (site) => normalizeRegistryKey(site.name) === nameKey,
  );

  if (candidates.length === 0) {
    return { site: null, matchType: null };
  }

  const exactCompany = candidates.find((site) => normalizeRegistryKey(site.companyName) === companyKey);
  if (exactCompany) {
    return { site: exactCompany, matchType: 'exact' };
  }

  const blankCompany = candidates.find((site) => !normalizeRegistryKey(site.companyName));
  if (blankCompany) {
    return { site: blankCompany, matchType: 'name-only' };
  }

  return { site: candidates[0] ?? null, matchType: candidates[0] ? 'name-only' : null };
}

export async function backfillSiteCompanyName(siteId: string, companyName: string | null | undefined) {
  const normalizedCompanyName = normalizeOptionalRegistryText(companyName);
  if (!normalizedCompanyName) return;

  const current = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, companyName: true },
  });
  if (!current) return;
  if (normalizeRegistryKey(current.companyName)) return;

  await prisma.site.update({
    where: { id: siteId },
    data: { companyName: normalizedCompanyName },
    select: { id: true },
  });
}

export async function findMatchingPartner(name: string, excludeId?: string): Promise<PartnerCandidate | null> {
  const nameKey = normalizeRegistryKey(name);
  if (!nameKey) return null;

  const candidates = await listPartnerCandidates(excludeId);
  return candidates.find((partner) => normalizeRegistryKey(partner.name) === nameKey) ?? null;
}

export async function ensurePartnerByName(name: string | null | undefined) {
  const normalizedName = normalizeOptionalRegistryText(name);
  if (!normalizedName) {
    return { partner: null, created: false } as const;
  }

  const existing = await findMatchingPartner(normalizedName);
  if (existing) {
    return { partner: existing, created: false } as const;
  }

  const created = await prisma.partner.create({
    data: { name: normalizedName },
    select: { id: true, name: true },
  });
  return { partner: created, created: true } as const;
}