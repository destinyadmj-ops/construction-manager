import pandas as pd
import os


class MarketRegimeAlertEngine:
    def __init__(self, ema_fast: int = 20, ema_slow: int = 50, bos_len: int = 5, vol_multiplier: float = 1.3):
        self.ema_fast = ema_fast
        self.ema_slow = ema_slow
        self.bos_len = int(os.getenv('ALERT_B_BOS_LEN', str(bos_len)))
        self.vol_multiplier = float(os.getenv('ALERT_B_VOL_MULTIPLIER', str(vol_multiplier)))
        self.require_volume_expansion = str(os.getenv('ALERT_B_REQUIRE_VOLUME_EXPANSION', 'true')).lower() in ('1', 'true', 'yes', 'on')
        self.require_strict_bos = str(os.getenv('ALERT_B_REQUIRE_STRICT_BOS', 'true')).lower() in ('1', 'true', 'yes', 'on')
        self.bos_tolerance_bps = float(os.getenv('ALERT_B_BOS_TOLERANCE_BPS', '0.0'))
        raw_relax_symbols = str(os.getenv('ALERT_B_RELAX_SYMBOLS', 'SIRENUSDT,RIVERUSDT,HYPEUSDT,XRPUSDT,PEPEUSDT,SHIBUSDT,TSLAUSDT,ENJUSDT'))
        self.relax_symbols = {str(token or '').strip().upper() for token in raw_relax_symbols.split(',') if str(token or '').strip()}
        self.symbol_bos_tolerance_add_bps = float(os.getenv('ALERT_B_SYMBOL_BOS_TOLERANCE_ADD_BPS', '1.0'))
        raw_extra_relax_symbols = str(os.getenv('ALERT_B_EXTRA_RELAX_SYMBOLS', 'SIRENUSDT,PEPEUSDT,ENJUSDT'))
        self.extra_relax_symbols = {str(token or '').strip().upper() for token in raw_extra_relax_symbols.split(',') if str(token or '').strip()}
        self.symbol_extra_bos_tolerance_add_bps = float(os.getenv('ALERT_B_EXTRA_BOS_TOLERANCE_ADD_BPS', '1.0'))
        raw_strict_bos_exempt_symbols = str(os.getenv('ALERT_B_STRICT_BOS_EXEMPT_SYMBOLS', ''))
        self.strict_bos_exempt_symbols = {str(token or '').strip().upper() for token in raw_strict_bos_exempt_symbols.split(',') if str(token or '').strip()}
        raw_smc_exempt_symbols = str(os.getenv('ALERT_B_SMC_EXEMPT_SYMBOLS', ''))
        self.smc_exempt_symbols = {str(token or '').strip().upper() for token in raw_smc_exempt_symbols.split(',') if str(token or '').strip()}

    def check_alert(self, df: pd.DataFrame, smc_result: dict | None = None, symbol: str | None = None) -> dict:
        if df is None or len(df) < max(self.ema_slow, self.bos_len * 2 + 1, 20) + 2:
            return {
                "trend_regime": "unknown",
                "strategy": "none",
                "entry_side": None,
                "confidence": 0.0,
                "ema_fast": None,
                "ema_slow": None,
                "bos_up": False,
                "bos_down": False,
                "vol_expansion": False,
                "vol_ok": False,
                "require_volume_expansion": self.require_volume_expansion,
                "smc_long": False,
                "smc_short": False,
                "long_alert": False,
                "short_alert": False,
            }

        close = df["close"]
        high = df["high"]
        low = df["low"]
        volume = df["volume"]

        ema_fast_series = close.ewm(span=self.ema_fast, adjust=False).mean()
        ema_slow_series = close.ewm(span=self.ema_slow, adjust=False).mean()
        ema_fast_now = float(ema_fast_series.iloc[-1])
        ema_slow_now = float(ema_slow_series.iloc[-1])
        trend_up = ema_fast_now > ema_slow_now
        trend_down = ema_fast_now < ema_slow_now

        rolling_high = high.rolling(self.bos_len * 2 + 1, center=True).max()
        rolling_low = low.rolling(self.bos_len * 2 + 1, center=True).min()
        symbol_u = str(symbol or '').upper()
        effective_bos_tolerance_bps = max(0.0, self.bos_tolerance_bps)
        if symbol_u in self.relax_symbols:
            effective_bos_tolerance_bps += max(0.0, self.symbol_bos_tolerance_add_bps)
        if symbol_u in self.extra_relax_symbols:
            effective_bos_tolerance_bps += max(0.0, self.symbol_extra_bos_tolerance_add_bps)
        strict_bos_effective = bool(self.require_strict_bos and (symbol_u not in self.strict_bos_exempt_symbols))
        tolerance = effective_bos_tolerance_bps / 10000.0
        bos_up = bool(close.iloc[-1] >= (rolling_high.iloc[-1] * (1.0 - tolerance))) if pd.notna(rolling_high.iloc[-1]) else False
        bos_down = bool(close.iloc[-1] <= (rolling_low.iloc[-1] * (1.0 + tolerance))) if pd.notna(rolling_low.iloc[-1]) else False

        vol_base = volume.rolling(20).mean().iloc[-1]
        vol_expansion = bool(volume.iloc[-1] > (vol_base * self.vol_multiplier)) if pd.notna(vol_base) else False

        smc_long = bool((smc_result or {}).get("long_alert", False))
        smc_short = bool((smc_result or {}).get("short_alert", False))
        smc_required_effective = bool(symbol_u not in self.smc_exempt_symbols)

        vol_ok = bool(vol_expansion or (not self.require_volume_expansion))

        bos_ok_long = bool(bos_up or (not strict_bos_effective))
        bos_ok_short = bool(bos_down or (not strict_bos_effective))

        long_alert = bool(trend_up and bos_ok_long and vol_ok and (smc_long or not smc_required_effective))
        short_alert = bool(trend_down and bos_ok_short and vol_ok and (smc_short or not smc_required_effective))

        long_points = int(trend_up) + int(bos_up) + int(vol_expansion) + int(smc_long)
        short_points = int(trend_down) + int(bos_down) + int(vol_expansion) + int(smc_short)
        confidence = max(long_points, short_points) / 4.0

        if long_alert:
            strategy = "trend_follow_long"
            entry_side = "buy"
        elif short_alert:
            strategy = "trend_follow_short"
            entry_side = "sell"
        else:
            strategy = "wait"
            entry_side = None

        trend_regime = "trend_up" if trend_up else "trend_down" if trend_down else "flat"
        return {
            "trend_regime": trend_regime,
            "strategy": strategy,
            "entry_side": entry_side,
            "confidence": confidence,
            "ema_fast": ema_fast_now,
            "ema_slow": ema_slow_now,
            "bos_up": bos_up,
            "bos_down": bos_down,
            "vol_expansion": vol_expansion,
            "vol_ok": vol_ok,
            "require_volume_expansion": self.require_volume_expansion,
            "require_strict_bos": self.require_strict_bos,
            "strict_bos_effective": strict_bos_effective,
            "smc_required_effective": smc_required_effective,
            "bos_tolerance_bps": effective_bos_tolerance_bps,
            "symbol_relax_applied": bool(symbol_u in self.relax_symbols),
            "symbol_extra_relax_applied": bool(symbol_u in self.extra_relax_symbols),
            "symbol_strict_bos_exempt_applied": bool(symbol_u in self.strict_bos_exempt_symbols),
            "symbol_smc_exempt_applied": bool(symbol_u in self.smc_exempt_symbols),
            "smc_long": smc_long,
            "smc_short": smc_short,
            "long_alert": long_alert,
            "short_alert": short_alert,
        }