from tools.sanitize_prices import sanitize

if __name__ == '__main__':
    inp='bot_v2/tools/data/btc_highvol.csv'
    out='bot_v2/tools/data/btc_highvol_sanitized_v5.csv'
    # remove clipping by allowing much larger max_price but keep realistic per-step cap
    sanitize(inp, out_path=out, max_jump=0.05, min_price=10.0, max_price=1e12)
    print('Generated', out)
