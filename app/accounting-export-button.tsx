'use client';

import { useCallback, useState } from 'react';

type Props = {
  body?: unknown;
  presetKey?: string;
  label?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFilenameFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) return null;

  // Examples:
  // content-disposition: attachment; filename="accounting_export_....csv"
  // content-disposition: attachment; filename*=UTF-8''accounting_export.csv
  const filenameStarMatch = headerValue.match(/filename\*=([^;]+)/i);
  if (filenameStarMatch?.[1]) {
    const raw = filenameStarMatch[1].trim();
    const parts = raw.split("''");
    const encoded = parts.length === 2 ? parts[1] : raw;
    try {
      return decodeURIComponent(encoded.replace(/^UTF-8''/i, '').replace(/^"|"$/g, ''));
    } catch {
      return encoded.replace(/^UTF-8''/i, '').replace(/^"|"$/g, '');
    }
  }

  const filenameMatch = headerValue.match(/filename=([^;]+)/i);
  if (filenameMatch?.[1]) {
    return filenameMatch[1].trim().replace(/^"|"$/g, '');
  }

  return null;
}

export default function AccountingExportButton({
  body = {},
  presetKey,
  label = '会計CSVをダウンロード',
}: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      let resolvedBody: unknown = body ?? {};

      if (presetKey) {
        const presetRes = await fetch(
          `/api/accounting/export-preset?key=${encodeURIComponent(presetKey)}`,
          { method: 'GET' },
        );
        if (presetRes.ok) {
          const presetJson = (await presetRes.json().catch(() => null)) as
            | { body?: unknown }
            | null;
          const presetBody = presetJson?.body ?? {};

          if (isPlainObject(presetBody) && isPlainObject(resolvedBody)) {
            resolvedBody = { ...presetBody, ...resolvedBody };
          } else {
            resolvedBody = presetBody;
          }
        }
      }

      const res = await fetch('/api/accounting/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(resolvedBody ?? {}),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const filename =
        parseFilenameFromContentDisposition(res.headers.get('content-disposition')) ??
        `accounting_export_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;

      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsLoading(false);
    }
  }, [body, isLoading, presetKey]);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={isLoading}
        className="inline-flex items-center justify-center rounded-lg border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {isLoading ? '出力中…' : label}
      </button>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
