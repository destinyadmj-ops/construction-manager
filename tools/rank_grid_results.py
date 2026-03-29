import json
from pathlib import Path
import csv

GRID_DIR = Path('bot_v2') / 'tools' / 'reports' / 'grid_search'
src = GRID_DIR / 'grid_summary.json'
if not src.exists():
    print('grid_summary.json not found in', GRID_DIR)
    raise SystemExit(1)

data = json.loads(src.read_text(encoding='utf-8'))
sorted_data = sorted(data, key=lambda x: x.get('total_pnl_sum', 0), reverse=True)

# write ranked CSV
out_csv = GRID_DIR / 'grid_summary_ranked.csv'
with out_csv.open('w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['combo_idx','total_pnl_sum','avg_win_rate','runs','thresholds_json'])
    for item in sorted_data:
        writer.writerow([item.get('combo_idx'), item.get('total_pnl_sum'), item.get('avg_win_rate'), item.get('runs'), json.dumps(item.get('thresholds'))])

# write top5 json
top5 = sorted_data[:5]
(GRID_DIR / 'grid_top5.json').write_text(json.dumps(top5, ensure_ascii=False, indent=2), encoding='utf-8')

print('Wrote', out_csv, 'and grid_top5.json')
