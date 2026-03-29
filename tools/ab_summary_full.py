"""要約 (拡張結果) -> CSV/MD
"""
import json, csv

def summarize(in_path, out_prefix):
    with open(in_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    rows = []
    for entry in data:
        coef = entry.get('coef')
        res = entry.get('result', {})
        agg = res.get('aggregate', {})
        rows.append({'coef': coef, 'runs': agg.get('runs',0), 'total_pnl_sum': agg.get('total_pnl_sum',0.0), 'avg_win_rate': agg.get('avg_win_rate',0.0)})
    csv_path = out_prefix + '.csv'
    md_path = out_prefix + '.md'
    with open(csv_path, 'w', encoding='utf-8', newline='') as cf:
        writer = csv.DictWriter(cf, fieldnames=['coef','runs','total_pnl_sum','avg_win_rate'])
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
    with open(md_path, 'w', encoding='utf-8') as mf:
        mf.write('| coef | runs | total_pnl_sum | avg_win_rate |\n')
        mf.write('|---:|---:|---:|---:|\n')
        for r in rows:
            mf.write(f"| {r['coef']} | {r['runs']} | {r['total_pnl_sum']:.6f} | {r['avg_win_rate']:.4f} |\n")
    print('Wrote', csv_path, 'and', md_path)

if __name__ == '__main__':
    summarize('tools/ab_results_full.json', 'tools/ab_summary_full')
