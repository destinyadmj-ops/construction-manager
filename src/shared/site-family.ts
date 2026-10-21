export type SiteFamilyInfo = {
  key: string | null;
  label: string | null;
  memberCount: number;
};

function normalizeSiteFamilySourceText(input: string | null | undefined) {
  return (input ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function siteFamilyDisplayName(input: string | null | undefined) {
  let value = normalizeSiteFamilySourceText(input);

  if (!value) return '';

  const slashParts = value.split(/[／/]/u).map((part) => part.trim()).filter((part) => part.length > 0);
  if (slashParts.length >= 2) {
    value = slashParts[slashParts.length - 1] ?? value;
  }

  return value
    .replace(/^(?:株式会社|有限会社|合同会社|合名会社|合資会社|医療法人|社会福祉法人|学校法人|宗教法人)\s*/u, '')
    .replace(/^[（(](?:株|有|同|名|資|医|社福|学|宗)[)）]\s*/u, '')
    .trim();
}

export function hasSiteFamilyDisplayPrefix(input: string | null | undefined) {
  const source = normalizeSiteFamilySourceText(input);
  if (!source) return false;
  return siteFamilyDisplayName(source) !== source;
}

export function normalizeSiteFamilyText(input: string | null | undefined) {
  return siteFamilyDisplayName(input).replace(/\s+/g, '').trim();
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

// 同じ peerNames 配列(参照が同じ)に対する正規化結果と判定結果を使い回す。
// 現場約1000件 × セル数ぶん呼ばれるため、毎回全件を正規化すると週切替のたびに数百msかかっていた。
// 配列は呼び出し側で作り替えない前提(作り替えると参照が変わり、キャッシュは使われないだけで結果は同じ)。
const peerInfoCache = new WeakMap<object, { texts: string[]; keys: string[] }>();
const familyResultCache = new WeakMap<object, Map<string, SiteFamilyInfo>>();

function getPeerInfo(peerNames: Array<string | null | undefined>) {
  let info = peerInfoCache.get(peerNames);
  if (!info) {
    const texts = peerNames.map((name) => normalizeSiteFamilyText(name));
    info = { texts, keys: texts.map((text) => normalizeSiteFamilyKey(text)) };
    peerInfoCache.set(peerNames, info);
  }
  return info;
}

export function findSiteFamily(
  anchorName: string | null | undefined,
  peerNames: Array<string | null | undefined>,
): SiteFamilyInfo {
  const resultKey = anchorName ?? '';
  let results = familyResultCache.get(peerNames);
  const cachedResult = results?.get(resultKey);
  if (cachedResult) return cachedResult;

  const result = computeSiteFamily(anchorName, peerNames);
  if (!results) {
    results = new Map();
    familyResultCache.set(peerNames, results);
  }
  results.set(resultKey, result);
  return result;
}

function computeSiteFamily(
  anchorName: string | null | undefined,
  peerNames: Array<string | null | undefined>,
): SiteFamilyInfo {
  const anchorDisplay = normalizeSiteFamilyText(anchorName);
  const anchorKey = normalizeSiteFamilyKey(anchorName);
  if (!anchorKey) return { key: null, label: null, memberCount: 0 };

  const info = getPeerInfo(peerNames);
  const seen = new Set<string>();
  const peerKeys: string[] = [];
  const addPeer = (text: string, key: string) => {
    if (text.length === 0 || seen.has(text)) return;
    seen.add(text);
    peerKeys.push(key);
  };
  addPeer(anchorDisplay, normalizeSiteFamilyKey(anchorDisplay));
  for (let i = 0; i < info.texts.length; i += 1) addPeer(info.texts[i], info.keys[i]);

  const candidates = new Map<string, string>();

  for (const peerKey of peerKeys) {
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
    const memberCount = peerKeys.reduce((count, peerKey) => (peerKey.startsWith(candidateKey) ? count + 1 : count), 0);
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
  const displayName = siteFamilyDisplayName(siteName);
  const displayFamilyLabel = siteFamilyDisplayName(familyLabel);
  const normalizedName = normalizeSiteFamilyText(displayName);
  const normalizedFamilyLabel = normalizeSiteFamilyText(displayFamilyLabel);
  if (!normalizedName || !normalizedFamilyLabel) return displayName;
  if (!normalizeSiteFamilyKey(normalizedName).startsWith(normalizeSiteFamilyKey(normalizedFamilyLabel))) {
    return displayName;
  }
  const rest = displayName.slice(displayFamilyLabel.length).replace(/^[／/・･._()（）-]+/u, '').trim();
  return rest || displayName;
}