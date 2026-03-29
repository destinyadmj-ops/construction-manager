from bot_v2.tools.grid_search import run_grid
from pathlib import Path

# expanded indices for btc_sample (step 50 up to 450)
indices = [0,50,100,150,200,250,300,350,400,450]
csv_path = str(Path('bot_v2') / 'tools' / 'data' / 'btc_sample.csv')
print('Running grid on:', csv_path, 'indices:', indices)
run_grid(indices=indices, csv_path=csv_path)
