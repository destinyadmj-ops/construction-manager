import json
import ast
import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate

import csv

# read top3 from grid_top5_summary.csv
top3 = []
with open('bot_v2/tools/reports/grid_top5_summary.csv','r',encoding='utf-8') as f:
    r = csv.DictReader(f)
    for i,row in enumerate(r):
        if i<3:
            th = ast.literal_eval(row.get('thresholds_json') or '[]')
            top3.append(th)

csv_path='bot_v2/tools/data/btc_highvol_sanitized.csv'
entries=[0,100]
size=0.01
side='buy'
strategy='alert_d'

for idx, thresholds in enumerate(top3, start=1):
    print('Running combo', idx, 'thresholds', thresholds)
    # patch config
    cfg.DYNAMIC_SL_THRESHOLDS = [(float(t[0]), float(t[1])) for t in thresholds]
    for e in entries:
        print(' -> entry', e)
        simulate(csv_path, e, size, side, strategy)

print('Done')
