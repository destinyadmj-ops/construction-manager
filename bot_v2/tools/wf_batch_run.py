"""wf_batch_run.py

バッチで複数のエントリ位置／サイドを走らせて集計レポートを作る簡易スクリプト。
使い方:
python -m bot_v2.tools.wf_batch_run --csv data/btc_sample.csv --indices 0 100 200 --sides buy sell
"""
import argparse
import os
import json
from bot_v2.tools.walkforward_sim import simulate


def run_batch(csv_path: str, indices: list[int], sides: list[str], size: float, strategy: str, atr_default: float = 10.0):
    reports = []
    for idx in indices:
        for side in sides:
            print(f'Running entry_index={idx} side={side}')
            simulate(csv_path, int(idx), size, side, strategy, atr_default)
            base = os.path.splitext(os.path.basename(csv_path))[0]
            rpt = os.path.join(os.path.dirname(__file__), 'reports', f'{base}_wf_report.json')
            if os.path.exists(rpt):
                with open(rpt, 'r', encoding='utf-8') as rf:
                    try:
                        reports.append(json.load(rf))
                    except Exception:
                        pass
    # aggregate summary
    agg = {
        'runs': len(reports),
        'total_pnl_sum': sum(r.get('total_pnl', 0) for r in reports),
        'avg_win_rate': (sum(r.get('win_rate', 0) for r in reports) / len(reports)) if reports else 0.0,
    }
    out = os.path.join(os.path.dirname(__file__), 'reports', 'batch_summary.json')
    with open(out, 'w', encoding='utf-8') as of:
        json.dump({'aggregate': agg, 'reports': reports}, of, ensure_ascii=False, indent=2)
    print('Batch complete. Summary saved to', out)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--csv', required=True)
    p.add_argument('--indices', type=int, nargs='+', default=[0])
    p.add_argument('--sides', nargs='+', default=['buy'])
    p.add_argument('--size', type=float, default=0.01)
    p.add_argument('--strategy', default='alert_d')
    p.add_argument('--atr-default', type=float, default=10.0)
    args = p.parse_args()
    run_batch(args.csv, args.indices, args.sides, args.size, args.strategy, args.atr_default)
