"""Parse `logs/reward_shadow.log` and produce plots and a small HTML report.
Outputs to `logs/plots/`.
"""
import os
import json
from collections import Counter
import pandas as pd
import matplotlib.pyplot as plt

LOG_PATH = os.path.join('logs', 'reward_shadow.log')
OUT_DIR = os.path.join('logs', 'plots')
os.makedirs(OUT_DIR, exist_ok=True)

rows = []
reject_reasons = []
with open(LOG_PATH, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line or not (line.startswith('{') or line.startswith('[')):
            continue
        try:
            j = json.loads(line)
        except Exception:
            continue
        if 'components' in j and isinstance(j['components'], dict):
            comp = j['components']
            rows.append({'t': j.get('t'), 'action': j.get('action'), 'total': comp.get('total')})
        elif j.get('ok') is False:
            reject_reasons.append(j.get('reason'))

df = pd.DataFrame(rows)
if not df.empty:
    df = df.sort_values('t')
    plt.figure(figsize=(8,4))
    plt.plot(df['t'], df['total'], marker='o')
    plt.title('Reward total over time')
    plt.xlabel('t')
    plt.ylabel('total')
    plt.grid(True)
    out_ts = os.path.join(OUT_DIR, 'total_timeseries.png')
    plt.tight_layout()
    plt.savefig(out_ts)
    plt.close()

    plt.figure(figsize=(6,4))
    plt.hist(df['total'].dropna(), bins=20)
    plt.title('Histogram of total rewards')
    plt.xlabel('total')
    plt.ylabel('count')
    out_hist = os.path.join(OUT_DIR, 'hist_total.png')
    plt.tight_layout()
    plt.savefig(out_hist)
    plt.close()

# rejection counts
cnt = Counter(reject_reasons)
out_rej = os.path.join(OUT_DIR, 'rejection_counts.json')
with open(out_rej, 'w', encoding='utf-8') as f:
    json.dump(cnt, f, ensure_ascii=False, indent=2)

# simple HTML report
html = ['<html><body><h1>RL Shadow Run Report</h1>']
if not df.empty:
    html.append(f"<h2>Reward timeseries</h2><img src='total_timeseries.png'/>")
    html.append(f"<h2>Histogram</h2><img src='hist_total.png'/>")
html.append('<h2>Rejection counts</h2>')
html.append('<pre>' + json.dumps(cnt, ensure_ascii=False, indent=2) + '</pre>')
html.append('</body></html>')
with open(os.path.join(OUT_DIR, 'report.html'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(html))

print('Visualization complete. Plots ->', OUT_DIR)
