def compute_pnl(prev_price, new_price, size):
    return (new_price - prev_price) * size
