'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type InvoiceSearchItem = {
  siteId: string;
  siteLabel: string;
};

export default function SiteFoldersPage() {
  const params = useParams<{ siteId: string }>();
  const siteId = params?.siteId ?? '';
  const [inputName, setInputName] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [folders, setFolders] = useState<Array<{ dateYmd: string }>>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [timeClocks, setTimeClocks] = useState<Array<{ id: string; userId: string; inAt: string; outAt: string | null; note: string | null }>>([]);
  const [photos, setPhotos] = useState<Array<{ id: string; fileName: string }>>([]);
  const [reports, setReports] = useState<Array<{ id: string; fileName: string }>>([]);
  const [invoices, setInvoices] = useState<Array<{ id: string; fileName: string }>>([]);

  // 日付フォルダ一覧取得
  useEffect(() => {
    if (!siteId) return;
    (async () => {
      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}/folder/dates`);
      const j = await r.json().catch(() => null);
      if (j?.ok && Array.isArray(j.dates)) {
        setFolders(j.dates);
        if (j.dates.length > 0 && !selectedDate) setSelectedDate(j.dates[0].dateYmd);
      }
    })();
  }, [selectedDate, siteId]);

  // 選択日付のデータ取得
  useEffect(() => {
    if (!siteId || !selectedDate) return;
    // 従業員一覧
    fetch('/api/users?kind=NORMAL')
      .then(r => r.json())
      .then(j => setEmployees(Array.isArray(j.users) ? j.users : []));
    // 打刻
    fetch(`/api/time-clocks?siteId=${encodeURIComponent(siteId)}&date=${encodeURIComponent(selectedDate)}`)
      .then(r => r.json())
      .then(j => setTimeClocks(Array.isArray(j.items) ? j.items : []));
    // 写真・報告書
    fetch(`/api/sites/${encodeURIComponent(siteId)}/folder?date=${encodeURIComponent(selectedDate)}`)
      .then(r => r.json())
      .then(j => {
        setPhotos(Array.isArray(j.photos) ? j.photos : []);
        setReports(Array.isArray(j.reports) ? j.reports : []);
      });
    // 請求書（INVOICE kind）
    fetch(`/api/invoices/issue/search?from=${selectedDate}&to=${selectedDate}`)
      .then(r => r.json())
      .then(j => {
        if (Array.isArray(j.items)) {
          const items = j.items.filter(
            (item: unknown): item is InvoiceSearchItem =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as Record<string, unknown>).siteId === 'string' &&
              typeof (item as Record<string, unknown>).siteLabel === 'string',
          );
          // 現場ID一致のみ抽出
          setInvoices(
            items
              .filter((item: InvoiceSearchItem) => item.siteId === siteId)
              .map((item: InvoiceSearchItem) => ({ id: item.siteId, fileName: item.siteLabel })),
          );
        } else {
          setInvoices([]);
        }
      });
  }, [siteId, selectedDate]);
  return (
    <main className="mx-auto w-full max-w-screen-md px-4 py-4">
      <h1 className="text-lg font-bold mb-4">フォルダ管理（現場ID: {siteId}）</h1>
      <div className="mb-4">
        <input
          value={inputName}
          onChange={e => setInputName(e.target.value)}
          placeholder="予定セルに現場名を入力"
          className="w-full rounded border border-zinc-300 px-2 py-2 text-sm"
        />
        <button
          type="button"
          className="ml-2 rounded bg-blue-500 text-white px-4 py-2"
          disabled={!inputName.trim()}
          onClick={async () => {
            setStatusMsg(null);
            try {
              // APIでフォルダ作成（仮）
              const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/folders`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: inputName.trim() }),
              });
              const j = await res.json().catch(() => null);
              if (!res.ok || !j?.ok) throw new Error(j?.error || '作成失敗');
              setStatusMsg('フォルダを作成しました');
              setInputName('');
            } catch {
              setStatusMsg('フォルダ作成に失敗しました');
            }
          }}
        >
          フォルダ作成
        </button>
      </div>
      {statusMsg && <div className="mb-4 text-sm text-zinc-600">{statusMsg}</div>}
      <div className="mt-8">
        <div className="mb-2 font-medium text-zinc-700">日付フォルダ一覧</div>
        <div className="flex gap-2 flex-wrap mb-4">
          {folders.map(f => (
            <button
              key={f.dateYmd}
              type="button"
              className={`rounded border px-3 py-1 text-sm ${selectedDate === f.dateYmd ? 'bg-blue-500 text-white border-blue-500' : 'bg-white border-zinc-300 text-zinc-700'}`}
              onClick={() => setSelectedDate(f.dateYmd)}
            >
              {f.dateYmd}
            </button>
          ))}
        </div>
        <div className="rounded border border-zinc-300 p-4 bg-zinc-50">
          <div className="mb-2 text-sm font-bold">{selectedDate} の管理</div>
          <div className="mb-4">
            <div className="font-medium text-zinc-700 mb-1">従業員（打刻）</div>
            <div className="bg-white rounded p-2 border border-zinc-200">
              {employees.length === 0 ? '従業員データなし' : employees.map(emp => {
                const clocks = timeClocks.filter(tc => tc.userId === emp.id);
                return (
                  <div key={emp.id} className="mb-1">
                    {emp.name}：
                    {clocks.length === 0 ? '（打刻なし）' : clocks.map(tc => `IN:${tc.inAt.slice(11,16)}${tc.outAt ? ' / OUT:' + tc.outAt.slice(11,16) : ''}${tc.note ? ' / ' + tc.note : ''}`).join(' , ')}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mb-4">
            <div className="font-medium text-zinc-700 mb-1">写真</div>
            <div className="text-xs text-zinc-500 mb-2">（写真ファイル管理）</div>
            <div className="bg-white rounded p-2 border border-zinc-200">
              {photos.length === 0 ? '写真なし' : photos.map(p => (
                <div key={p.id}>{p.fileName}</div>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <div className="font-medium text-zinc-700 mb-1">報告書</div>
            <div className="text-xs text-zinc-500 mb-2">（報告書ファイル管理）</div>
            <div className="bg-white rounded p-2 border border-zinc-200">
              {reports.length === 0 ? '報告書なし' : reports.map(r => (
                <div key={r.id}>{r.fileName}</div>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <div className="font-medium text-zinc-700 mb-1">請求書</div>
            <div className="text-xs text-zinc-500 mb-2">（請求書ファイル管理・API連携は要調整）</div>
            <div className="bg-white rounded p-2 border border-zinc-200">
              {invoices.length === 0 ? '請求書なし' : invoices.map(i => (
                <div key={i.id}>{i.fileName}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
