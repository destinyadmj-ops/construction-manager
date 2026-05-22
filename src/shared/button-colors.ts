// ボタンラベルとカラーの共通定義
// 必要に応じて追加・修正してください
export const BUTTON_COLOR_MAP: Record<string, string> = {
  '週予定': 'bg-cyan-200 text-black',
  '月予定': 'bg-white text-black',
  '日常': 'bg-blue-200 text-black',
  '現場台帳': 'bg-yellow-200 text-black',
  'スケジュール': 'bg-red-200 text-black',
  '会計': 'bg-green-200 text-black',
  '報告書': 'bg-orange-200 text-black',
  '請求書': 'bg-emerald-200 text-black',
  '管理': 'bg-zinc-200 text-black',
  '関係会社': 'bg-blue-100 text-black',
  'マルチ': 'bg-pink-100 text-black',
};

export function getButtonColorClass(label: string): string {
  return BUTTON_COLOR_MAP[label] || 'bg-white text-black';
}
