def calculate_atr(df, period=14):
    if df is None or len(df) < 2:
        return 0.0
    try:
        high = df['high'].astype(float)
        low = df['low'].astype(float)
        close = df['close'].astype(float)
        prev_close = close.shift(1)
        tr = (high - low).abs().combine((high - prev_close).abs(), max).combine((low - prev_close).abs(), max)
        atr = tr.rolling(period, min_periods=1).mean().iloc[-1]
        return float(atr) if atr == atr else 0.0
    except Exception:
        return 0.0
