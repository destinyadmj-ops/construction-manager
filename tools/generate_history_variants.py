from pathlib import Path
from generate_history_csv import load_prices, sanitize_prices, compute_atr, write_csv


def make_variant(max_price, out_name):
    inp = Path('bot_v2/tools/data/btc_highvol.csv')
    if not inp.exists():
        inp = Path('bot_v2/tools/data/btc_highvol_sanitized_v4.csv')
    rows = load_prices(inp)
    sanitized = sanitize_prices(rows, max_jump=0.03, min_price=1000.0, max_price=max_price)
    atrs = compute_atr(sanitized, window=14)
    out = Path(f'bot_v2/tools/data/{out_name}')
    write_csv(sanitized, atrs, out)


def main():
    make_variant(100000.0, 'btc_history_100k.csv')
    make_variant(300000.0, 'btc_history_300k.csv')


if __name__ == '__main__':
    main()
