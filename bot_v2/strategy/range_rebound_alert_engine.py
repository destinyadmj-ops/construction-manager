import pandas as pd
import os


class RangeReboundAlertEngine:
    def __init__(
        self,
        ema_fast: int = 20,
        ema_slow: int = 50,
        ema_flat_bps: float = 4.0,
        vol_window: int = 20,
        vol_max_std: float = 0.0018,
        range_lookback: int = 20,
        rsi_len: int = 14,
        rsi_oversold: float = 35.0,
        rsi_overbought: float = 65.0,
    ):
        self.ema_fast = ema_fast
        self.ema_slow = ema_slow
        self.ema_flat_bps = ema_flat_bps
        self.vol_window = vol_window
        self.vol_max_std = vol_max_std
        self.range_lookback = range_lookback
        self.rsi_len = rsi_len
        self.rsi_oversold = rsi_oversold
        self.rsi_overbought = rsi_overbought
        self.vol_max_std_multiplier = float(os.getenv('ALERT_C_VOL_MAX_STD_MULTIPLIER', '1.0'))
        self.spike_multiplier = float(os.getenv('ALERT_C_VOLATILITY_SPIKE_MULTIPLIER', '1.8'))
        self.ema_flat_bps = float(os.getenv('ALERT_C_EMA_FLAT_BPS', str(self.ema_flat_bps)))
        raw_relax_symbols = str(os.getenv('ALERT_CD_RELAX_SYMBOLS', 'SIRENUSDT,RIVERUSDT,HYPEUSDT,XRPUSDT,PEPEUSDT,SHIBUSDT,TSLAUSDT,ENJUSDT'))
        self.relax_symbols = {str(token or '').strip().upper() for token in raw_relax_symbols.split(',') if str(token or '').strip()}
        self.symbol_vol_relax_multiplier = float(os.getenv('ALERT_C_NEW_SYMBOL_VOL_MULTIPLIER', '1.04'))
        raw_extra_relax_symbols = str(os.getenv('ALERT_CD_EXTRA_RELAX_SYMBOLS', 'SIRENUSDT,PEPEUSDT,TSLAUSDT,ENJUSDT'))
        self.extra_relax_symbols = {str(token or '').strip().upper() for token in raw_extra_relax_symbols.split(',') if str(token or '').strip()}
        self.symbol_extra_vol_relax_multiplier = float(os.getenv('ALERT_C_EXTRA_VOL_MULTIPLIER', '1.03'))

    def _rsi(self, close: pd.Series) -> pd.Series:
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0).rolling(self.rsi_len).mean()
        loss = (-delta.where(delta < 0, 0.0)).rolling(self.rsi_len).mean()
        rs = gain / loss.replace(0, pd.NA)
        return 100 - (100 / (1 + rs))

    def check_alert(self, df: pd.DataFrame, ob_result: dict | None = None, sweep_result: dict | None = None, symbol: str | None = None) -> dict:
        min_len = max(self.ema_slow, self.vol_window, self.range_lookback, self.rsi_len) + 2
        if df is None or len(df) < min_len:
            return {
                "market_regime": "unknown",
                "strategy": "none",
                "entry_side": None,
                "confidence": 0.0,
                "ema_flat": False,
                "low_volatility": False,
                "no_range_breakout": False,
                "ob_bull": False,
                "ob_bear": False,
                "rsi_long": False,
                "rsi_short": False,
                "sweep_low": False,
                "sweep_high": False,
                "long_alert": False,
                "short_alert": False,
            }

        close = df["close"]
        high = df["high"]
        low = df["low"]

        ema_fast_now = float(close.ewm(span=self.ema_fast, adjust=False).mean().iloc[-1])
        ema_slow_now = float(close.ewm(span=self.ema_slow, adjust=False).mean().iloc[-1])
        price_now = float(close.iloc[-1])
        ema_gap_bps = abs(ema_fast_now - ema_slow_now) / price_now * 10000 if price_now > 0 else 9999
        ema_flat = bool(ema_gap_bps <= self.ema_flat_bps)

        ret_std = float(close.pct_change().rolling(self.vol_window).std().iloc[-1])
        effective_vol_max_std = self.vol_max_std * max(0.5, self.vol_max_std_multiplier)
        symbol_u = str(symbol or '').upper()
        if symbol_u in self.relax_symbols:
            effective_vol_max_std = effective_vol_max_std * max(1.0, self.symbol_vol_relax_multiplier)
        if symbol_u in self.extra_relax_symbols:
            effective_vol_max_std = effective_vol_max_std * max(1.0, self.symbol_extra_vol_relax_multiplier)
        effective_spike_threshold = effective_vol_max_std * max(1.2, self.spike_multiplier)
        low_volatility = bool(pd.notna(ret_std) and ret_std <= effective_vol_max_std)
        volatility_spike = bool(pd.notna(ret_std) and ret_std >= effective_spike_threshold)

        prev_high = float(high.iloc[-(self.range_lookback + 1):-1].max())
        prev_low = float(low.iloc[-(self.range_lookback + 1):-1].min())
        no_range_breakout = bool((high.iloc[-1] <= prev_high) and (low.iloc[-1] >= prev_low))

        rsi_now = float(self._rsi(close).iloc[-1])
        rsi_long = bool(rsi_now <= self.rsi_oversold)
        rsi_short = bool(rsi_now >= self.rsi_overbought)

        ob_bull = bool((ob_result or {}).get("bull_ob"))
        ob_bear = bool((ob_result or {}).get("bear_ob"))
        sweep_low = bool((sweep_result or {}).get("sweep_low", False))
        sweep_high = bool((sweep_result or {}).get("sweep_high", False))

        long_alert = bool((not volatility_spike) and ema_flat and low_volatility and no_range_breakout and ob_bull and rsi_long and sweep_low)
        short_alert = bool((not volatility_spike) and ema_flat and low_volatility and no_range_breakout and ob_bear and rsi_short and sweep_high)

        long_points = sum([ema_flat, low_volatility, no_range_breakout, ob_bull, rsi_long, sweep_low])
        short_points = sum([ema_flat, low_volatility, no_range_breakout, ob_bear, rsi_short, sweep_high])
        confidence = max(long_points, short_points) / 6.0

        if long_alert:
            strategy = "range_rebound_long"
            entry_side = "buy"
        elif short_alert:
            strategy = "range_rebound_short"
            entry_side = "sell"
        else:
            strategy = "wait"
            entry_side = None

        return {
            "market_regime": "range" if ema_flat and low_volatility else "non_range",
            "strategy": strategy,
            "entry_side": entry_side,
            "confidence": confidence,
            "ret_std": ret_std,
            "symbol_relax_applied": bool(symbol_u in self.relax_symbols),
            "symbol_extra_relax_applied": bool(symbol_u in self.extra_relax_symbols),
            "effective_vol_max_std": effective_vol_max_std,
            "effective_spike_threshold": effective_spike_threshold,
            "volatility_spike": volatility_spike,
            "ema_flat": ema_flat,
            "low_volatility": low_volatility,
            "no_range_breakout": no_range_breakout,
            "ob_bull": ob_bull,
            "ob_bear": ob_bear,
            "rsi": rsi_now,
            "rsi_long": rsi_long,
            "rsi_short": rsi_short,
            "sweep_low": sweep_low,
            "sweep_high": sweep_high,
            "long_alert": long_alert,
            "short_alert": short_alert,
        }