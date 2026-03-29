from tools.sanitize_prices import sanitize

if __name__ == '__main__':
    inp='bot_v2/tools/data/btc_highvol.csv'
    out='bot_v2/tools/data/btc_highvol_sanitized_v3.csv'
    # looser max_jump to preserve larger moves
    sanitize(inp, out_path=out, max_jump=0.10, min_price=10.0, max_price=1e6)
    print('Generated', out)
