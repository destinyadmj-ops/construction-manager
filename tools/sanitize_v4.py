from tools.sanitize_prices import sanitize

if __name__ == '__main__':
    inp='bot_v2/tools/data/btc_highvol.csv'
    out='bot_v2/tools/data/btc_highvol_sanitized_v4.csv'
    # realistic sanitization: cap per-step jumps to 5%, enforce min price 100, max 1e6
    sanitize(inp, out_path=out, max_jump=0.05, min_price=100.0, max_price=1e6)
    print('Generated', out)
