from datetime import datetime, timezone
import os
import pandas as pd


class TriggerSeparatedAlertEngine:
    def __init__(
        self,
        vol_window: int = 20,
        vol_threshold: float = 0.0022,
        session_start_utc: int = 0,
        session_end_utc: int = 23,
        micro_bos_len: int = 5,
        rsi_len: int = 14,
        rsi_cross_level: float = 50.0,
        require_all: bool = True,
    ):
        self.vol_window = vol_window
        vol_mult = float(os.getenv('ALERT_D_VOL_THRESHOLD_MULTIPLIER', '1.0'))
        self.vol_threshold = vol_threshold * max(0.7, vol_mult)
        self.session_start_utc = session_start_utc
        self.session_end_utc = session_end_utc
        self.micro_bos_len = micro_bos_len
        self.rsi_len = rsi_len
        self.rsi_cross_level = rsi_cross_level
        self.require_all = str(os.getenv('ALERT_D_REQUIRE_ALL', str(require_all))).lower() in ('1', 'true', 'yes', 'on')
        raw_relax_symbols = str(os.getenv('ALERT_CD_RELAX_SYMBOLS', 'SIRENUSDT,RIVERUSDT,HYPEUSDT,XRPUSDT,PEPEUSDT,SHIBUSDT,TSLAUSDT,ENJUSDT'))
        self.relax_symbols = {str(token or '').strip().upper() for token in raw_relax_symbols.split(',') if str(token or '').strip()}
        self.symbol_vol_threshold_multiplier = float(os.getenv('ALERT_D_NEW_SYMBOL_VOL_THRESHOLD_MULTIPLIER', '0.97'))
        raw_extra_relax_symbols = str(os.getenv('ALERT_CD_EXTRA_RELAX_SYMBOLS', 'SIRENUSDT,PEPEUSDT,TSLAUSDT,ENJUSDT'))
        self.extra_relax_symbols = {str(token or '').strip().upper() for token in raw_extra_relax_symbols.split(',') if str(token or '').strip()}
        self.symbol_extra_vol_threshold_multiplier = float(os.getenv('ALERT_D_EXTRA_VOL_THRESHOLD_MULTIPLIER', '0.98'))

    def _rsi(self, close: pd.Series) -> pd.Series:
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0).rolling(self.rsi_len).mean()
        loss = (-delta.where(delta < 0, 0.0)).rolling(self.rsi_len).mean()
        rs = gain / loss.replace(0, pd.NA)
        return 100 - (100 / (1 + rs))

    def _in_session(self) -> bool:
        hour = datetime.now(timezone.utc).hour
        if self.session_start_utc <= self.session_end_utc:
            return self.session_start_utc <= hour <= self.session_end_utc
        return hour >= self.session_start_utc or hour <= self.session_end_utc

    def check_alert(
        self,
        df: pd.DataFrame,
        market_regime: str,
        ob_result: dict | None,
        sweep_result: dict | None,
        smc_result: dict | None,
        symbol: str | None = None,
    ) -> dict:
        min_len = max(self.vol_window, self.micro_bos_len + 2, self.rsi_len + 2)
        if df is None or len(df) < min_len:
            return {
                "strategy": "wait",
                "entry_side": None,
                "confidence": 0.0,
                "context": {},
                "setup": {},
                "trigger": {},
                "long_alert": False,
                "short_alert": False,
            }

        close = df["close"]
        high = df["high"]
        low = df["low"]

        ret_std = float(close.pct_change().rolling(self.vol_window).std().iloc[-1])
        effective_vol_threshold = self.vol_threshold
        symbol_u = str(symbol or '').upper()
        if symbol_u in self.relax_symbols:
            effective_vol_threshold = effective_vol_threshold * min(1.0, max(0.85, self.symbol_vol_threshold_multiplier))
        if symbol_u in self.extra_relax_symbols:
            effective_vol_threshold = effective_vol_threshold * min(1.0, max(0.85, self.symbol_extra_vol_threshold_multiplier))
        high_vol = bool(pd.notna(ret_std) and ret_std >= effective_vol_threshold)
        in_session = self._in_session()
        context_ok = bool(market_regime in ("trend", "range") and in_session and high_vol)

        has_order_block = bool((ob_result or {}).get("bull_ob") or (ob_result or {}).get("bear_ob"))
        has_liquidity_zone = bool((sweep_result or {}).get("sweep_low") or (sweep_result or {}).get("sweep_high"))
        has_smc_structure = bool((smc_result or {}).get("long_alert") or (smc_result or {}).get("short_alert"))
        setup_ok = bool(has_order_block and has_liquidity_zone and has_smc_structure)

        smc_long = bool((smc_result or {}).get("long_alert", False))
        smc_short = bool((smc_result or {}).get("short_alert", False))

        rsi = self._rsi(close)
        rsi_prev = float(rsi.iloc[-2]) if pd.notna(rsi.iloc[-2]) else 50.0
        rsi_now = float(rsi.iloc[-1]) if pd.notna(rsi.iloc[-1]) else 50.0
        rsi_cross_up = bool(rsi_prev < self.rsi_cross_level <= rsi_now)
        rsi_cross_down = bool(rsi_prev > self.rsi_cross_level >= rsi_now)

        prev_micro_high = float(high.iloc[-(self.micro_bos_len + 1):-1].max())
        prev_micro_low = float(low.iloc[-(self.micro_bos_len + 1):-1].min())
        micro_bos_up = bool(close.iloc[-1] > prev_micro_high)
        micro_bos_down = bool(close.iloc[-1] < prev_micro_low)

        long_trigger = bool(smc_long and rsi_cross_up and micro_bos_up)
        short_trigger = bool(smc_short and rsi_cross_down and micro_bos_down)
        trigger_ok = bool(long_trigger or short_trigger)

        if self.require_all:
            long_alert = bool(context_ok and setup_ok and long_trigger)
            short_alert = bool(context_ok and setup_ok and short_trigger)
        else:
            long_alert = bool((long_trigger and setup_ok) or (long_trigger and context_ok))
            short_alert = bool((short_trigger and setup_ok) or (short_trigger and context_ok))

        context_points = int(market_regime in ("trend", "range")) + int(in_session) + int(high_vol)
        setup_points = int(has_order_block) + int(has_liquidity_zone) + int(has_smc_structure)
        trigger_points = int(smc_long or smc_short) + int(rsi_cross_up or rsi_cross_down) + int(micro_bos_up or micro_bos_down)
        confidence = (context_points + setup_points + trigger_points) / 9.0

        if long_alert:
            strategy = "sniper_long"
            entry_side = "buy"
        elif short_alert:
            strategy = "sniper_short"
            entry_side = "sell"
        else:
            strategy = "wait"
            entry_side = None

        return {
            "strategy": strategy,
            "entry_side": entry_side,
            "confidence": confidence,
            "context": {
                "market_regime": market_regime,
                "in_session": in_session,
                "ret_std": ret_std,
                "high_vol_threshold": effective_vol_threshold,
                "symbol_relax_applied": bool(symbol_u in self.relax_symbols),
                "symbol_extra_relax_applied": bool(symbol_u in self.extra_relax_symbols),
                "high_volatility": high_vol,
                "ok": context_ok,
            },
            "setup": {
                "order_block": has_order_block,
                "liquidity_zone": has_liquidity_zone,
                "smc_structure": has_smc_structure,
                "ok": setup_ok,
            },
            "trigger": {
                "smc_long": smc_long,
                "smc_short": smc_short,
                "rsi_cross_up": rsi_cross_up,
                "rsi_cross_down": rsi_cross_down,
                "micro_bos_up": micro_bos_up,
                "micro_bos_down": micro_bos_down,
                "ok": trigger_ok,
            },
            "long_alert": long_alert,
            "short_alert": short_alert,
        }