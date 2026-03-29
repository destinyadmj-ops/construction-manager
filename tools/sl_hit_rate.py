import csv
import json
import os
import random
import shutil
import ast
import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate

# load top combo thresholds
with open('bot_v2/tools/reports/grid_top5_summary.csv','r',encoding='utf-8') as f:
    r=csv.DictReader(f)
    first=next(r)
    thresholds = ast.literal_eval(first.get('thresholds_json') or '[]')
    cfg.DYNAMIC_SL_THRESHOLDS = [(float(t[0]), float(t[1])) for t in thresholds]

csv_path='bot_v2/tools/data/btc_highvol_sanitized_v3.csv'
base_name = os.path.splitext(os.path.basename(csv_path))[0]
rows = []
with open(csv_path,'r',encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        rows.append(row)
N=len(rows)
indices = sorted(random.sample(range(0, max(1,N-60)), min(20, max(1,N-60))))

os.makedirs('bot_v2/tools/reports/sl_samples', exist_ok=True)
summary = []
for idx in indices:
    tmp_csv = f'bot_v2/tools/data/{base_name}_entry_{idx}.csv'
    # write copy
    with open(tmp_csv,'w',encoding='utf-8') as out:
        out.write('timestamp,price,atr\n')
        for i in range(len(rows)):
            r = rows[i]
            out.write(f"{i},{r.get('price','')},{r.get('atr','')}\n")
    # run simulate
    simulate(tmp_csv, idx, 0.01, 'buy', 'alert_d')
    # read report
    rpt = f'bot_v2/tools/reports/{base_name}_wf_report.json'
    data = {}
    try:
        with open(rpt,'r',encoding='utf-8') as rf:
            data = json.load(rf)
    except Exception:
        data = {}
    trades = data.get('trades', [])
    sl_hits = sum(1 for t in trades if 'dynamic_sl' in (t.get('reason') or '') or 'hard_stop' in (t.get('reason') or ''))
    summary.append({'entry_index': idx, 'entry_price': data.get('entry_price'), 'num_trades': data.get('num_trades'), 'sl_hits': sl_hits, 'total_pnl': data.get('total_pnl')})
    # cleanup tmp csv
    try:
        os.remove(tmp_csv)
    except Exception:
        pass

out_csv='bot_v2/tools/reports/sl_hit_rate_summary.csv'
with open(out_csv,'w',encoding='utf-8') as wf:
    wf.write('entry_index,entry_price,num_trades,sl_hits,total_pnl\n')
    for s in summary:
        wf.write(f"{s['entry_index']},{s['entry_price']},{s['num_trades']},{s['sl_hits']},{s['total_pnl']}\n")

with open('bot_v2/tools/reports/sl_hit_rate_summary.json','w',encoding='utf-8') as jf:
    json.dump(summary, jf, ensure_ascii=False, indent=2)

print('Wrote', out_csv)
print('Wrote bot_v2/tools/reports/sl_hit_rate_summary.json')
