"""grid_search.py

簡易グリッド探索: `DYNAMIC_SL_THRESHOLDS` の組合せを試し、各組合せごとに
指定 indices/sides で `simulate()` を実行してレポートを保存します。

使い方（デフォルト実行）:
python -m bot_v2.tools.grid_search
"""
import itertools
import os
import shutil
import json
from pathlib import Path

import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate


REPORTS_DIR = Path(__file__).parent / 'reports'
GRID_DIR = REPORTS_DIR / 'grid_search'
GRID_DIR.mkdir(parents=True, exist_ok=True)


def run_grid(roi_hi_vals=None, roi_mid_vals=None, roi_lo_vals=None, indices=None, sides=None, csv_path=None):
    if roi_hi_vals is None:
        roi_hi_vals = [0.08, 0.09, 0.10]
    if roi_mid_vals is None:
        roi_mid_vals = [0.11, 0.12, 0.14]
    if roi_lo_vals is None:
        roi_lo_vals = [0.16, 0.18, 0.20]
    if indices is None:
        indices = [0, 50, 100, 150]
    if sides is None:
        sides = ['buy', 'sell']
    if csv_path is None:
        csv_path = str(Path(__file__).parent / 'data' / 'btc_sample.csv')

    combo_idx = 0
    grid_summary = []
    for hi, mid, lo in itertools.product(roi_hi_vals, roi_mid_vals, roi_lo_vals):
        combo_idx += 1
        thresholds = [(0.8, hi), (0.5, mid), (0.0, lo)]
        # patch config in-memory
        cfg.DYNAMIC_SL_THRESHOLDS = thresholds

        run_folder = GRID_DIR / f'run_{combo_idx:03d}_h{int(hi*100)}_m{int(mid*100)}_l{int(lo*100)}'
        run_folder.mkdir(parents=True, exist_ok=True)

        reports = []
        for idx in indices:
            for side in sides:
                print(f'Grid run {combo_idx}: hi={hi} mid={mid} lo={lo} -> entry={idx} side={side}')
                # simulate will write report to bot_v2/tools/reports/<base>_wf_report.json
                simulate(csv_path, int(idx), 0.01, side, 'alert_d', 10.0)
                base = Path(csv_path).stem
                src_report = Path(__file__).parent / 'reports' / f'{base}_wf_report.json'
                src_cum = Path(__file__).parent / 'reports' / f'{base}_cum_equity.csv'
                if src_report.exists():
                    dest_report = run_folder / f'{base}_entry_{idx}_{side}_report.json'
                    shutil.move(str(src_report), str(dest_report))
                    reports.append(json.loads(dest_report.read_text(encoding='utf-8')))
                if src_cum.exists():
                    dest_cum = run_folder / f'{base}_entry_{idx}_{side}_cum.csv'
                    shutil.move(str(src_cum), str(dest_cum))

        # aggregate for this combo
        agg = {
            'combo_idx': combo_idx,
            'thresholds': thresholds,
            'runs': len(reports),
            'total_pnl_sum': sum(r.get('total_pnl', 0) for r in reports),
            'avg_win_rate': (sum(r.get('win_rate', 0) for r in reports) / len(reports)) if reports else 0.0,
        }
        (run_folder / 'combo_summary.json').write_text(json.dumps({'aggregate': agg, 'reports': reports}, ensure_ascii=False, indent=2), encoding='utf-8')
        grid_summary.append(agg)

    # write grid-wide summary
    out = GRID_DIR / 'grid_summary.json'
    out.write_text(json.dumps(grid_summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Grid search complete. Results in', GRID_DIR)


if __name__ == '__main__':
    run_grid()
