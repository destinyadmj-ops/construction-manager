import json
from pathlib import Path
import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate

GRID_DIR = Path('bot_v2') / 'tools' / 'reports' / 'grid_search'
top_path = GRID_DIR / 'grid_top5.json'
if not top_path.exists():
    print('grid_top5.json not found; run synthetic grid first')
    raise SystemExit(1)

top = json.loads(top_path.read_text(encoding='utf-8'))
csv_path = str(Path('bot_v2') / 'tools' / 'data' / 'synthetic.csv')

for i, item in enumerate(top, start=1):
    thresholds = item.get('thresholds')
    cfg.DYNAMIC_SL_THRESHOLDS = thresholds
    print(f'Running top#{i} thresholds={thresholds}')
    simulate(csv_path, entry_index=0, size=1.0, side='buy', strategy='alert_d', atr_default=1.0)
