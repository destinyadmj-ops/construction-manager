def dynamic_trailing(entry_price, current_price, atr, volatility, profit=None):
    base = atr * 1.5
    multiplier = 1 + volatility * 10
    trail = base * multiplier
    # 利益ロック進化
    if profit is not None and profit > 2 * atr:
        trail = atr * 0.5
    return current_price - trail
