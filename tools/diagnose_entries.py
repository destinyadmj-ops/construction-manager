import csv
import sys
from pathlib import Path

def load_prices(path):
    rows = []
    with open(path, newline='') as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(float(r['price']))
    return rows

def dump_window(prices, idx, pre=20, post=60):
    n = len(prices)
    start = max(0, idx - pre)
    end = min(n - 1, idx + post)
    window = prices[start:end+1]
    out = []
    out.append(f"Entry index: {idx}  entry_price: {prices[idx]:.2f}  window [{start}:{end}]")
    out.append("index,price")
    for i, p in enumerate(window, start=start):
        out.append(f"{i},{p:.8f}")
    out.append(f"window_min: {min(window):.8f}  window_max: {max(window):.8f}\n")
    return "\n".join(out)

def main():
    csv_path = Path("bot_v2/tools/data/btc_sample.csv")
    if len(sys.argv) > 1:
        csv_path = Path(sys.argv[1])
    entries = [0, 50, 100, 150]
    if len(sys.argv) > 2:
        try:
            import json
            entries = json.loads(sys.argv[2])
        except Exception:
            pass

    prices = load_prices(csv_path)
    out_lines = []
    out_lines.append(f"Loaded {len(prices)} price rows from {csv_path}")
    for idx in entries:
        if idx < 0 or idx >= len(prices):
            out_lines.append(f"Entry index {idx} out of range")
            continue
        out_lines.append(dump_window(prices, idx))

    out_text = "\n".join(out_lines)
    print(out_text)
    try:
        with open('tools/diagnose_entries_out.txt', 'w', encoding='utf-8') as f:
            f.write(out_text)
    except Exception:
        pass

if __name__ == '__main__':
    main()
