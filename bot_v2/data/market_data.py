import requests

BASE = "https://api.bitget.com"
PRODUCT_TYPE = "USDT-FUTURES"

TF_MAP = {
    "1m": "60",
    "5m": "300",
    "15m": "900",
    "30m": "1800",
    "1h": "3600",
    "1d": "1D",
}

AGGREGATED_TIMEFRAMES = {
    "10m": ("5m", 600000, 2),
}


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _fetch_direct_candles(symbol, timeframe, limit="100"):
    granularity = TF_MAP.get(timeframe)
    if not granularity:
        print("Invalid timeframe:", timeframe)
        return None

    params = {
        "symbol": symbol,
        "productType": PRODUCT_TYPE,
        "granularity": granularity,
        "limit": str(limit),
    }

    try:
        response = requests.get(f"{BASE}/api/v2/mix/market/candles", params=params, timeout=5)
        data = response.json()
        if data.get("code") != "00000":
            print("Bitget API error:", data)
            return None
        return data.get("data")
    except Exception as exc:
        print("Candle fetch error:", exc)
        return None


def _aggregate_candles(rows, bucket_ms, expected_rows):
    if not isinstance(rows, list):
        return None

    buckets = []
    current_key = None
    current_rows = []

    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            continue
        try:
            timestamp = int(row[0])
        except (TypeError, ValueError):
            continue

        bucket_key = (timestamp // bucket_ms) * bucket_ms
        if current_key is None:
            current_key = bucket_key
        if bucket_key != current_key:
            if len(current_rows) >= expected_rows:
                buckets.append(_build_bucket(current_key, current_rows))
            current_key = bucket_key
            current_rows = []
        current_rows.append(row)

    if current_rows and len(current_rows) >= expected_rows:
        buckets.append(_build_bucket(current_key, current_rows))

    return buckets


def _build_bucket(bucket_key, rows):
    first = rows[0]
    last = rows[-1]
    high = max(_to_float(row[2]) for row in rows)
    low = min(_to_float(row[3]) for row in rows)
    volume = sum(_to_float(row[5]) for row in rows)
    quote_volume = sum(_to_float(row[6]) for row in rows if len(row) > 6)
    return [
        str(bucket_key),
        str(first[1]),
        str(high),
        str(low),
        str(last[4]),
        str(volume),
        str(quote_volume),
    ]


def get_candles(symbol, tf):
    aggregate_spec = AGGREGATED_TIMEFRAMES.get(tf)
    if aggregate_spec:
        source_tf, bucket_ms, expected_rows = aggregate_spec
        source_rows = _fetch_direct_candles(symbol, source_tf, limit="200")
        return _aggregate_candles(source_rows, bucket_ms, expected_rows)

    return _fetch_direct_candles(symbol, tf)