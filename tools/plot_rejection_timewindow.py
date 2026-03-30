import json
import argparse
import os
from collections import defaultdict
import math
import csv
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    HAS_MPL = True
except Exception:
    HAS_MPL = False

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--outdir', required=True)
parser.add_argument('--window', type=int, default=5)
args = parser.parse_args()

inp = args.input
outd = args.outdir
win = args.window
os.makedirs(outd, exist_ok=True)

# read entries grouped by t
entries_by_t = defaultdict(list)
all_t = set()
with open(inp, 'r', encoding='utf-8') as f:
    for line in f:
        line=line.strip()
        if not line: continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        t = obj.get('t')
        if t is None:
            # fallback: use incremental index
            continue
        entries_by_t[int(t)].append(obj)
        all_t.add(int(t))

if not all_t:
    print('no timestep info found')
    exit(1)

min_t = min(all_t)
max_t = max(all_t)

# compute per-t rejection rate
rejection_by_t = {}
for t in range(min_t, max_t+1):
    lst = entries_by_t.get(t, [])
    if not lst:
        rejection_by_t[t] = None
        continue
    total = len(lst)
    rej = sum(1 for e in lst if e.get('ok') is False)
    rejection_by_t[t] = rej / total

# windowed aggregation
windowed = []
window_centers = []
csv_rows = []
t = min_t
while t <= max_t:
    ws = list(range(t, min(t+win, max_t+1)))
    vals = [rejection_by_t.get(x) for x in ws if rejection_by_t.get(x) is not None]
    if vals:
        avg = sum(vals)/len(vals)
    else:
        avg = float('nan')
    windowed.append(avg)
    center = (ws[0] + ws[-1]) / 2.0
    window_centers.append(center)
    csv_rows.append({'start': ws[0], 'end': ws[-1], 'avg_rejection': avg, 'n_steps': len(ws)})
    t += win

# write CSV
csv_path = os.path.join(outd, 'rejection_window.csv')
with open(csv_path, 'w', newline='', encoding='utf-8') as cf:
    writer = csv.DictWriter(cf, fieldnames=['start','end','avg_rejection','n_steps'])
    writer.writeheader()
    for r in csv_rows:
        writer.writerow(r)

if HAS_MPL:
    plt.figure(figsize=(8,3))
    plt.plot(window_centers, windowed, marker='o')
    plt.xlabel('t (window center)')
    plt.ylabel('rejection rate')
    plt.title(f'Rejection rate (window={win})')
    plt.grid(True)
    png_path = os.path.join(outd, 'rejection_rate.png')
    plt.tight_layout()
    plt.savefig(png_path)
    print('wrote', png_path, 'and', csv_path)
else:
    print('matplotlib not available; wrote', csv_path)
