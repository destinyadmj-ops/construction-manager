import csv
from pathlib import Path
import statistics


def load_prices(path):
    p = Path(path)
    rows = []
    with p.open(newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            ts = row.get('timestamp') or row.get('time') or ''
            try:
                price = float(row.get('price') or row.get('close') or row.get('mid') or 0.0)
            except Exception:
                price = 0.0
            rows.append({'timestamp': ts, 'price': price})
    return rows


def sanitize_prices(rows, max_jump=0.03, min_price=1000.0, max_price=200000.0):
    if not rows:
        return []
    out = []
    # find first valid
    first = None
    for r in rows:
        if r['price'] and r['price'] > 0:
            first = max(min_price, min(max_price, abs(r['price'])))
            break
    if first is None:
        first = min_price
    prev = first
    for r in rows:
        val = abs(r['price']) if r['price'] and r['price'] > 0 else None
        if val is None:
            # propagate previous
            new_p = prev
        else:
            ret = (val - prev) / prev
            clipped = max(-max_jump, min(max_jump, ret))
            new_p = prev * (1 + clipped)
            new_p = max(min_price, min(max_price, new_p))
        out.append({'timestamp': r['timestamp'], 'price': new_p})
        prev = new_p
    return out


def compute_atr(prices, window=14):
    # simple ATR-like: rolling mean of absolute returns
    diffs = []
    for i in range(1, len(prices)):
        diffs.append(abs(prices[i]['price'] - prices[i-1]['price']))
    atr = [0.0] * len(prices)
    for i in range(len(prices)):
        start = max(0, i - window + 1)
        if i == 0:
            atr[i] = diffs[0] if diffs else 0.0
        else:
            window_vals = diffs[start:i] if i>start else diffs[i-1:i]
            if window_vals:
                atr[i] = statistics.mean(window_vals)
            else:
                atr[i] = diffs[i-1] if i-1 < len(diffs) else 0.0
    # ensure no zero atr
    for i in range(len(atr)):
        if atr[i] <= 0:
            atr[i] = max(1.0, prices[i]['price'] * 0.001)
    return atr


def write_csv(prices, atrs, out_path):
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['timestamp', 'price', 'atr'])
        for i, rec in enumerate(prices):
            ts = rec['timestamp'] if rec['timestamp'] is not None else i
            w.writerow([ts, f"{rec['price']:.8f}", f"{atrs[i]:.8f}"])
    print('Wrote', out_path)


def main():
    inp = Path('bot_v2/tools/data/btc_highvol.csv')
    if not inp.exists():
        # fallback to sanitized v4 if raw missing
        inp = Path('bot_v2/tools/data/btc_highvol_sanitized_v4.csv')
    rows = load_prices(inp)
    sanitized = sanitize_prices(rows, max_jump=0.03, min_price=1000.0, max_price=200000.0)
    atrs = compute_atr(sanitized, window=14)
    out = Path('bot_v2/tools/data/btc_history_2026.csv')
    write_csv(sanitized, atrs, out)


if __name__ == '__main__':
    main()
