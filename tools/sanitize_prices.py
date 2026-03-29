import csv
from pathlib import Path


def sanitize(input_path, out_path=None, max_jump=0.03, min_price=10.0, max_price=1e7):
    p = Path(input_path)
    if out_path is None:
        out_path = p.with_name(p.stem + '_sanitized.csv')

    rows = []
    with p.open(newline='') as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                rows.append(float(row['price']))
            except Exception:
                rows.append(0.0)

    if not rows:
        raise SystemExit('no rows')

    out = []
    prev = max(min_price, min(max_price, abs(rows[0]) if rows[0] != 0 else min_price))
    for raw in rows:
        val = abs(raw)
        if val == 0:
            ret = 0.0
        else:
            ret = (val - prev) / prev
        clipped = max(-max_jump, min(max_jump, ret))
        new_p = prev * (1 + clipped)
        new_p = max(min_price, min(max_price, new_p))
        out.append(new_p)
        prev = new_p

    with Path(out_path).open('w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['timestamp', 'price', 'atr'])
        for i, price in enumerate(out):
            w.writerow([i, f"{price:.8f}", ''])

    print('Wrote sanitized file:', out_path)
    return out_path


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print('Usage: python tools/sanitize_prices.py <input_csv>')
        raise SystemExit(1)
    inp = sys.argv[1]
    sanitize(inp)
