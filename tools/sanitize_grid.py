from tools.sanitize_prices import sanitize
from bot_v2.tools.walkforward_sim import simulate
import os
import json

INP='bot_v2/tools/data/btc_highvol.csv'
REPORT_DIR='bot_v2/tools/reports/sanitize_grid'
os.makedirs(REPORT_DIR, exist_ok=True)

jumps=[0.03,0.05,0.08]
entries_per_file=[0,100,250]
size=0.01
side='buy'
strategy='alert_d'

grid_summary=[]
for mj in jumps:
    out=f'bot_v2/tools/data/btc_highvol_sanitized_grid_{int(mj*100)}.csv'
    print('Sanitizing with max_jump=',mj,'->',out)
    sanitize(INP, out_path=out, max_jump=mj, min_price=100.0, max_price=1e6)
    per_results=[]
    for e in entries_per_file:
        print(' Running WF entry',e)
        simulate(out, e, size, side, strategy)
        rpt = os.path.join('bot_v2','tools','reports', os.path.splitext(os.path.basename(out))[0] + '_wf_report.json')
        if not os.path.isfile(rpt):
            per_results.append({'entry_index': e, 'error': 'report_missing'})
            continue
        with open(rpt,'r',encoding='utf-8') as rf:
            data=json.load(rf)
        trades=data.get('trades', [])
        sl_hits=sum(1 for t in trades if ('dynamic_sl' in (t.get('reason') or '') or 'hard_stop' in (t.get('reason') or '')))
        per_results.append({'entry_index': e, 'entry_price': data.get('entry_price'), 'num_trades': data.get('num_trades'), 'sl_hits': sl_hits, 'total_pnl': data.get('total_pnl')})
    grid_summary.append({'max_jump': mj, 'out': out, 'results': per_results})

out_path=os.path.join(REPORT_DIR,'sanitize_grid_summary.json')
with open(out_path,'w',encoding='utf-8') as of:
    json.dump(grid_summary, of, ensure_ascii=False, indent=2)
print('Wrote', out_path)
