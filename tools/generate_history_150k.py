from pathlib import Path
from generate_history_csv import load_prices, sanitize_prices, compute_atr, write_csv


def main():
    inp = Path('bot_v2/tools/data/btc_highvol.csv')
    if not inp.exists():
        inp = Path('bot_v2/tools/data/btc_highvol_sanitized_v4.csv')
    rows = load_prices(inp)
    sanitized = sanitize_prices(rows, max_jump=0.03, min_price=1000.0, max_price=150000.0)
    atrs = compute_atr(sanitized, window=14)
    out = Path('bot_v2/tools/data/btc_history_150k.csv')
    write_csv(sanitized, atrs, out)


if __name__ == '__main__':
    main()
