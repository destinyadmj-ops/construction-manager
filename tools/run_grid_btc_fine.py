from bot_v2.tools.grid_search import run_grid
from pathlib import Path

# fine-grained indices (every 10) for btc_sample
indices = list(range(0,500,10))
csv_path = str(Path('bot_v2') / 'tools' / 'data' / 'btc_sample.csv')

# reduce ROI combinations slightly to limit runtime while increasing index granularity
hi_vals = [0.08, 0.1]
mid_vals = [0.11, 0.14]
lo_vals = [0.16, 0.2]

print('Running fine-grained grid on:', csv_path, 'indices count:', len(indices))
run_grid(roi_hi_vals=hi_vals, roi_mid_vals=mid_vals, roi_lo_vals=lo_vals, indices=indices, csv_path=csv_path)
