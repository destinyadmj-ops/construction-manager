export type SiteFamilyInfo = {
  key: string | null;
  label: string | null;
  memberCount: number;
};

export function normalizeSiteFamilyText(input: string | null | undefined) {
  return (input ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

export function normalizeSiteFamilyKey(input: string | null | undefined) {
  return normalizeSiteFamilyText(input).toLocaleLowerCase('ja-JP');
}

function commonPrefixLength(left: string, right: string) {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index;
}

function cleanupFamilyLabel(prefix: string) {
  let value = normalizeSiteFamilyText(prefix);
  if (!value) return '';

  for (;;) {
    const next = value
      .replace(/[／/・･._-]+$/u, '')
      .replace(/[（(][^()（）]*$/u, '')
      .trim();
    if (next === value) return next;
    value = next;
    if (!value) return '';
  }
}

export function findSiteFamily(
  anchorName: string | null | undefined,
  peerNames: Array<string | null | undefined>,
): SiteFamilyInfo {
  const anchorDisplay = normalizeSiteFamilyText(anchorName);
  const anchorKey = normalizeSiteFamilyKey(anchorName);
  if (!anchorKey) return { key: null, label: null, memberCount: 0 };

  const peers = Array.from(
    new Set([anchorDisplay, ...peerNames.map((name) => normalizeSiteFamilyText(name))].filter((name) => name.length > 0)),
  );
  const candidates = new Map<string, string>();

  for (const peer of peers) {
    const peerKey = normalizeSiteFamilyKey(peer);
    if (!peerKey || peerKey === anchorKey) continue;
    const prefixLength = commonPrefixLength(anchorKey, peerKey);
    if (prefixLength < 2) continue;

    const cleanedLabel = cleanupFamilyLabel(anchorDisplay.slice(0, prefixLength));
    const cleanedKey = normalizeSiteFamilyKey(cleanedLabel);
    if (cleanedKey.length < 2) continue;
    candidates.set(cleanedKey, cleanedLabel);
  }

  let best: { key: string; label: string; memberCount: number } | null = null;
  for (const [candidateKey, candidateLabel] of candidates) {
    const memberCount = peers.reduce(
      (count, peer) => (normalizeSiteFamilyKey(peer).startsWith(candidateKey) ? count + 1 : count),
      0,
    );
    if (memberCount < 2) continue;
    if (
      !best ||
      memberCount > best.memberCount ||
      (memberCount === best.memberCount && candidateLabel.length < best.label.length) ||
      (memberCount === best.memberCount && candidateLabel.length === best.label.length && candidateLabel < best.label)
    ) {
      best = { key: candidateKey, label: candidateLabel, memberCount };
    }
  }

  return best ?? { key: null, label: null, memberCount: 1 };
}

export function stripSiteFamilyLabel(
  siteName: string | null | undefined,
  familyLabel: string | null | undefined,
) {
  const normalizedName = normalizeSiteFamilyText(siteName);
  const normalizedFamilyLabel = normalizeSiteFamilyText(familyLabel);
  if (!normalizedName || !normalizedFamilyLabel) return normalizedName;
  if (!normalizeSiteFamilyKey(normalizedName).startsWith(normalizeSiteFamilyKey(normalizedFamilyLabel))) {
    return normalizedName;
  }
  const rest = normalizedName.slice(normalizedFamilyLabel.length).replace(/^[／/・･._()（）-]+/u, '');
  return rest || normalizedName;
}