import csv
import json
import os
import random
import sys
from pathlib import Path
import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate


def patch_top5():
    path = Path('bot_v2/tools/reports/grid_top5_summary.csv')
    if not path.exists():
        return
    import ast
    with path.open(encoding='utf-8') as f:
        r = csv.DictReader(f)
        try:
            first = next(r)
        except StopIteration:
            return
        cfg.DYNAMIC_SL_THRESHOLDS = [(float(t[0]), float(t[1])) for t in ast.literal_eval(first.get('thresholds_json') or '[]')]


def run(csv_path, out_dir):
    patch_top5()
    rows = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(row)
    N = len(rows)
    indices = sorted(random.sample(range(0, max(1, N-61)), min(100, max(1, N-61))))
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    summary = []
    base = Path(csv_path).stem
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

    out_csv = Path(out_dir) / f'random_sl_sample_100_{base}.csv'
    with out_csv.open('w', encoding='utf-8') as of:
        of.write('entry_index,entry_price,num_trades,sl_hits,total_pnl\n')
        for s in summary:
            of.write(f"{s['entry_index']},{s['entry_price']},{s['num_trades']},{s['sl_hits']},{s['total_pnl']}\n")

    with (Path(out_dir) / f'random_sl_sample_100_{base}.json').open('w', encoding='utf-8') as jf:
        json.dump(summary, jf, ensure_ascii=False, indent=2)

    print('Wrote', out_csv)


def main():
    if len(sys.argv) < 2:
        print('Usage: python tools/random_sl_sample_generic.py <csv_path> [out_dir]')
        raise SystemExit(1)
    csv_path = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else 'bot_v2/tools/reports/random_sl_sample_variants'
    run(csv_path, out_dir)


if __name__ == '__main__':
    main()
