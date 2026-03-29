import csv
import json
from pathlib import Path


def read_csv_summary(path):
    p = Path(path)
    if not p.exists():
        return None
    rows = []
    with p.open(encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                rows.append({
                    'entry_index': int(row.get('entry_index') or 0),
                    'entry_price': float(row.get('entry_price') or 0.0),
                    'num_trades': float(row.get('num_trades') or 0.0),
                    'sl_hits': float(row.get('sl_hits') or 0.0),
                    'total_pnl': float(row.get('total_pnl') or 0.0),
                })
            except Exception:
                continue
    return rows


def summarize_rows(rows):
    if not rows:
        return {'samples': 0}
    n = len(rows)
    avg_sl = sum(r['sl_hits'] for r in rows) / n
    avg_pnl = sum(r['total_pnl'] for r in rows) / n
    avg_trades = sum(r['num_trades'] for r in rows) / n
    pct_zero_trades = sum(1 for r in rows if r['num_trades'] == 0) / n
    return {
        'samples': n,
        'avg_sl_hits': avg_sl,
        'avg_total_pnl': avg_pnl,
        'avg_num_trades': avg_trades,
        'pct_zero_trades': pct_zero_trades,
    }


def main():
    reports = Path('bot_v2/tools/reports')
    out_csv = reports / 'final_full_report.csv'
    out_json = reports / 'final_full_report.json'

    datasets = {
        'v5_random': reports / 'random_sl_sample' / 'random_sl_sample_100.csv',
        'v4_random': reports / 'random_sl_sample_v4' / 'random_sl_sample_100_v4.csv',
        'history_random': reports / 'random_sl_sample_history' / 'random_sl_sample_100_history.csv',
    }

    summary = {}
    for name, path in datasets.items():
        rows = read_csv_summary(path)
        summary[name] = summarize_rows(rows)

    # include top5 combos if available
    top5_json = reports / 'final_top5_sl_report.json'
    top5 = []
    if top5_json.exists():
        with top5_json.open(encoding='utf-8') as f:
            data = json.load(f)
            top5 = data.get('top5', [])

    final = {
        'datasets': summary,
        'top5': top5,
    }

    # write CSV with simple table
    with out_csv.open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['dataset','samples','avg_sl_hits','avg_total_pnl','avg_num_trades','pct_zero_trades'])
        for k,v in summary.items():
            w.writerow([k, v.get('samples',0), v.get('avg_sl_hits',0), v.get('avg_total_pnl',0), v.get('avg_num_trades',0), v.get('pct_zero_trades',0)])

    with out_json.open('w', encoding='utf-8') as f:
        json.dump(final, f, ensure_ascii=False, indent=2)

    print('Wrote', out_csv)
    print('Wrote', out_json)


if __name__ == '__main__':
    main()
