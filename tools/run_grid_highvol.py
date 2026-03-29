from bot_v2.tools.grid_search import run_grid
from pathlib import Path

csv_path = str(Path('bot_v2') / 'tools' / 'data' / 'btc_highvol_v2.csv')
print('Running grid on:', csv_path)
run_grid(csv_path=csv_path)
