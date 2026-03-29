"""plot_reports.py

バッチ結果の JSON を読み、各ランの累積エクイティを PNG にプロットして
`bot_v2/tools/reports/plots/` に保存します。

使い方:
python -m bot_v2.tools.plot_reports
"""
import os
import json
from pathlib import Path

REPORT_DIR = Path(__file__).parent / 'reports'
SUMMARY_JSON = REPORT_DIR / 'batch_summary.json'
PLOTS_DIR = REPORT_DIR / 'plots'


def ensure_plots_dir():
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)


def plot_reports():
    if not SUMMARY_JSON.exists():
        print('batch_summary.json が見つかりません:', SUMMARY_JSON)
        return
    try:
        import matplotlib.pyplot as plt
    except Exception as e:
        print('matplotlib が必要です。インストールしてください: pip install matplotlib')
        return

    with open(SUMMARY_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    reports = data.get('reports', [])
    ensure_plots_dir()

    for i, rpt in enumerate(reports):
        entry_idx = rpt.get('entry_index')
        trades = rpt.get('trades', [])
        if not trades:
            # No trades: create a placeholder plot
            fig, ax = plt.subplots(figsize=(6, 3))
            ax.text(0.5, 0.5, 'No trades', ha='center', va='center', fontsize=12)
            ax.set_title(f'Entry {entry_idx} (run {i})')
            ax.set_axis_off()
            out = PLOTS_DIR / f'run_{i}_entry_{entry_idx}.png'
            fig.savefig(out, bbox_inches='tight')
            plt.close(fig)
            print('Saved (no trades):', out)
            continue

        # build cumulative pnl by trade order
        pnls = [t.get('pnl', 0.0) for t in trades]
        cum = []
        s = 0.0
        for p in pnls:
            s += p
            cum.append(s)

        fig, ax = plt.subplots(figsize=(8, 4))
        ax.step(range(1, len(cum) + 1), cum, where='post')
        ax.set_xlabel('Trade #')
        ax.set_ylabel('Cumulative PnL')
        ax.set_title(f'Entry {entry_idx} (run {i})')
        ax.grid(True, linestyle='--', alpha=0.5)
        out = PLOTS_DIR / f'run_{i}_entry_{entry_idx}.png'
        fig.savefig(out, bbox_inches='tight')
        plt.close(fig)
        print('Saved plot:', out)


if __name__ == '__main__':
    plot_reports()
