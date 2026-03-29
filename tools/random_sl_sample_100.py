import csv
import json
import os
import random
import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate

csv_path='bot_v2/tools/data/btc_highvol_sanitized_v5.csv'
base = os.path.splitext(os.path.basename(csv_path))[0]

# patch top thresholds
import ast
with open('bot_v2/tools/reports/grid_top5_summary.csv','r',encoding='utf-8') as f:
    r=csv.DictReader(f)
    first=next(r)
    cfg.DYNAMIC_SL_THRESHOLDS = [(float(t[0]), float(t[1])) for t in ast.literal_eval(first.get('thresholds_json') or '[]')]

# load rows
rows=[]
with open(csv_path,'r',encoding='utf-8') as f:
    r=csv.DictReader(f)
    for row in r:
        rows.append(row)
N=len(rows)
indices = sorted(random.sample(range(0, max(1,N-61)), min(100, max(1,N-61))))

os.makedirs('bot_v2/tools/reports/random_sl_sample', exist_ok=True)
summary=[]
for idx in indices:
    simulate(csv_path, idx, 0.01, 'buy', 'alert_d')
    rpt = f'bot_v2/tools/reports/{base}_wf_report.json'
    try:
        with open(rpt,'r',encoding='utf-8') as rf:
            data=json.load(rf)
    except Exception:
        data={}
    trades=data.get('trades', [])
    sl_hits=sum(1 for t in trades if ('dynamic_sl' in (t.get('reason') or '') or 'hard_stop' in (t.get('reason') or '')))
    summary.append({'entry_index': idx, 'entry_price': data.get('entry_price'), 'num_trades': data.get('num_trades'), 'sl_hits': sl_hits, 'total_pnl': data.get('total_pnl')})

out_csv='bot_v2/tools/reports/random_sl_sample/random_sl_sample_100.csv'
with open(out_csv,'w',encoding='utf-8') as of:
    of.write('entry_index,entry_price,num_trades,sl_hits,total_pnl\n')
    for s in summary:
        of.write(f"{s['entry_index']},{s['entry_price']},{s['num_trades']},{s['sl_hits']},{s['total_pnl']}\n")

with open('bot_v2/tools/reports/random_sl_sample/random_sl_sample_100.json','w',encoding='utf-8') as jf:
    json.dump(summary,jf,ensure_ascii=False,indent=2)

print('Wrote', out_csv)
print('Wrote bot_v2/tools/reports/random_sl_sample/random_sl_sample_100.json')
