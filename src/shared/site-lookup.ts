function normalizeBaseText(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTextStrippingReadingParens(input: string | null | undefined): string {
  return normalizeBaseText(input).replace(/[（(]\s*[ぁ-ゖァ-ヺー・･\s]+\s*[）)]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeSiteLookupKey(value: string): string {
  return normalizeTextStrippingReadingParens(value)
    .replace(/（追記[:：].*?）$/u, '')
    .replace(/\(追記[:：].*?\)$/u, '')
    .replace(/^追記[:：]\s*/u, '')
    .replace(/\s\+\d+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}