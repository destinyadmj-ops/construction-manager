"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

export default function WorkSlipExcelEditor({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState<string>("");

  useEffect(() => {
    async function fetchExcel() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(id)}/download`);
        if (!res.ok) throw new Error("ファイル取得に失敗しました");
        const blob = await res.blob();
        setFileName(res.headers.get("Content-Disposition")?.split("filename=")[1] || "work-slip.xlsx");
        const arrayBuffer = await blob.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: "array" });
        setWorkbook(wb);
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明なエラー");
      } finally {
        setLoading(false);
      }
    }
    fetchExcel();
  }, [id]);

  function handleCellChange(sheet: string, row: number, col: number, value: string) {
    if (!workbook) return;
    const ws = workbook.Sheets[sheet];
    const cell = XLSX.utils.encode_cell({ r: row, c: col });
    ws[cell] = { t: "s", v: value };
    setWorkbook({ ...workbook });
  }

  function handleSave() {
    if (!workbook) return;
    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const formData = new FormData();
    formData.append("file", blob, fileName);
    fetch(`/api/documents/${encodeURIComponent(id)}/upload`, {
      method: "POST",
      body: formData,
    })
      .then((res) => {
        if (!res.ok) throw new Error("保存に失敗しました");
        alert("保存しました");
      })
      .catch((e) => alert(e.message));
  }

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div className="text-red-500">{error}</div>;
  if (!workbook) return <div>Excelデータがありません</div>;

  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];

  return (
    <main className="p-4 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="rounded px-3 py-1 bg-zinc-200 hover:bg-zinc-300">戻る</button>
        <h1 className="font-bold text-lg">Excel編集: {fileName}</h1>
        <button onClick={handleSave} className="ml-auto rounded px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600">保存</button>
      </div>
      <div className="overflow-auto border rounded-xl bg-white">
        <table className="min-w-full border-collapse">
          <tbody>
            {data.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="border px-2 py-1 min-w-[80px]">
                    <input
                      className="w-full bg-transparent outline-none"
                      value={cell ?? ""}
                      onChange={e => handleCellChange(sheetName, rIdx, cIdx, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
