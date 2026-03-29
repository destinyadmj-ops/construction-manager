import csv
from pathlib import Path
import math

in_path = Path('bot_v2') / 'tools' / 'data' / 'btc_sample.csv'
out_path = Path('bot_v2') / 'tools' / 'data' / 'btc_highvol_v2.csv'

rows = []
with in_path.open(newline='') as f:
    r = csv.DictReader(f)
    for row in r:
        rows.append(float(row['price']))

out = []
prev = rows[0]
scale = 1.2
max_jump = 0.03  # cap returns at +/-3%
for p in rows:
    # compute return from previous
    if prev == 0:
        ret = 0.0
    else:
        ret = (p - prev) / prev
    # amplify but cap
    amplified = max(-max_jump, min(max_jump, ret * scale))
    new_p = prev * (1 + amplified)
    # Clip prices to a sensible range to avoid numeric explosion
    new_p = max(1e-2, min(new_p, 1e8))
    out.append(new_p)
    prev = new_p

with out_path.open('w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['timestamp','price','atr'])
    for i, p in enumerate(out):
        writer.writerow([i, f"{p:.8f}", ''])

print('Wrote stable high-vol file:', out_path)
