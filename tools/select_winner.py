"""Select best A/B parameter from results and generate winner report.
Selection logic: primary = highest total_pnl_sum, tie-breaker = highest avg_win_rate.
Outputs: tools/ab_winner.json and tools/ab_winner.md
"""
import json, os

IN_PATH = 'tools/ab_results_full.json'
OUT_JSON = 'tools/ab_winner.json'
OUT_MD = 'tools/ab_winner.md'


def select_winner(in_path):
    with open(in_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    best = None
    for entry in data:
        coef = entry.get('coef')
        agg = entry.get('result', {}).get('aggregate', {})
        total_pnl = agg.get('total_pnl_sum', 0.0)
        win_rate = agg.get('avg_win_rate', 0.0)
        score = (total_pnl, win_rate)
        if best is None or score > best['score']:
            best = {'coef': coef, 'total_pnl_sum': total_pnl, 'avg_win_rate': win_rate, 'score': score, 'entry': entry}
    if best is None:
        raise RuntimeError('no entries')
    os.makedirs(os.path.dirname(OUT_JSON) or '.', exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as of:
        json.dump(best, of, ensure_ascii=False, indent=2)
    with open(OUT_MD, 'w', encoding='utf-8') as mf:
        mf.write('# A/B Winner\n\n')
        mf.write(f"**coef**: {best['coef']}\n\n")
        mf.write(f"**total_pnl_sum**: {best['total_pnl_sum']:.6f}\n\n")
        mf.write(f"**avg_win_rate**: {best['avg_win_rate']:.4f}\n\n")
        mf.write('Full entry:\n')
        mf.write('```json\n')
        json.dump(best['entry'], mf, ensure_ascii=False, indent=2)
        mf.write('\n```\n')
    return best

if __name__ == '__main__':
    best = select_winner(IN_PATH)
    print('Selected winner coef=', best['coef'])
