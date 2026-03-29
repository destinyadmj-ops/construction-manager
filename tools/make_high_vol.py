import csv
from pathlib import Path

in_path = Path('bot_v2') / 'tools' / 'data' / 'btc_sample.csv'
out_path = Path('bot_v2') / 'tools' / 'data' / 'btc_highvol.csv'

rows = []
with in_path.open(newline='') as f:
    r = csv.DictReader(f)
    for row in r:
        rows.append({'timestamp': row['timestamp'], 'price': float(row['price']), 'atr': row.get('atr','')})

out_rows = []
prev = rows[0]['price']
scale = 3.0
for i, r in enumerate(rows):
    if i == 0:
        p = r['price']
    else:
        ret = (r['price'] - prev)
        p = prev + ret * scale
    out_rows.append({'timestamp': r['timestamp'], 'price': f"{p:.8f}", 'atr': r['atr']})
    prev = p

with out_path.open('w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['timestamp','price','atr'])
    writer.writeheader()
    for r in out_rows:
        writer.writerow(r)

print('Wrote high-vol file:', out_path)
