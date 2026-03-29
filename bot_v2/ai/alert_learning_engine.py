import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class AlertLearningEngine:
    def __init__(self, store_path: str = "bot_v2/data/alert_learning_state.json", initial_weights: Optional[Dict[str, float]] = None):
        self.store_path = store_path
        self.initial_weights = initial_weights or {}
        self.state = self._load_state()

    def _default_state(self) -> Dict[str, Any]:
        alert_a_weight = float(self.initial_weights.get("alert_a", 1.0))
        alert_b_weight = float(self.initial_weights.get("alert_b", 1.0))
        alert_c_weight = float(self.initial_weights.get("alert_c", 1.0))
        alert_d_weight = float(self.initial_weights.get("alert_d", 1.0))
        return {
            "alerts": {
                "alert_a": {"weight": alert_a_weight, "closed": 0, "wins": 0, "roi_total": 0.0, "rr_total": 0.0, "pnl_total": 0.0, "last_profit": 0.0, "recent_profits": []},
                "alert_b": {"weight": alert_b_weight, "closed": 0, "wins": 0, "roi_total": 0.0, "rr_total": 0.0, "pnl_total": 0.0, "last_profit": 0.0, "recent_profits": []},
                "alert_c": {"weight": alert_c_weight, "closed": 0, "wins": 0, "roi_total": 0.0, "rr_total": 0.0, "pnl_total": 0.0, "last_profit": 0.0, "recent_profits": []},
                "alert_d": {"weight": alert_d_weight, "closed": 0, "wins": 0, "roi_total": 0.0, "rr_total": 0.0, "pnl_total": 0.0, "last_profit": 0.0, "recent_profits": []},
            },
            "trades": [],
            "next_trade_id": 1,
            "doten_history": {},
            "last_updated": None,
        }

    def _load_state(self) -> Dict[str, Any]:
        if not os.path.exists(self.store_path):
            state = self._default_state()
            self._save_state(state)
            return state
        with open(self.store_path, "r", encoding="utf-8") as file:
            loaded = json.load(file)
        default = self._default_state()
        default.update(loaded)
        default_alerts = default["alerts"]
        loaded_alerts = loaded.get("alerts", {})
        migration_map = {"alert_1": "alert_a", "alert_2": "alert_b", "alert_3": "alert_c", "alert_4": "alert_d"}
        for old_name, new_name in migration_map.items():
            if old_name in loaded_alerts and new_name not in loaded_alerts:
                loaded_alerts[new_name] = loaded_alerts[old_name]
        for alert_name in default_alerts.keys():
            default_alerts[alert_name].update(loaded_alerts.get(alert_name, {}))
        return default

    def _save_state(self, state: Optional[Dict[str, Any]] = None) -> None:
        if state is None:
            state = self.state
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)
        state["last_updated"] = datetime.now(timezone.utc).isoformat()
        with open(self.store_path, "w", encoding="utf-8") as file:
            json.dump(state, file, ensure_ascii=False, indent=2)

    def get_weight(self, alert_name: str) -> float:
        return float(self.state["alerts"].get(alert_name, {}).get("weight", 1.0))

    def get_alert_summary(self) -> Dict[str, Dict[str, Any]]:
        summary: Dict[str, Dict[str, Any]] = {}
        for alert_name, metrics in self.state["alerts"].items():
            closed = int(metrics.get("closed", 0))
            wins = int(metrics.get("wins", 0))
            roi_total = float(metrics.get("roi_total", 0.0))
            rr_total = float(metrics.get("rr_total", 0.0))
            pnl_total = float(metrics.get("pnl_total", 0.0))
            recent_profits = metrics.get("recent_profits", []) or []
            recent_profit_mean = (sum(float(v or 0.0) for v in recent_profits) / len(recent_profits)) if recent_profits else 0.0
            summary[alert_name] = {
                "weight": float(metrics.get("weight", 1.0)),
                "closed": closed,
                "wins": wins,
                "losses": max(closed - wins, 0),
                "win_rate": (wins / closed) if closed > 0 else 0.0,
                "roi_total": roi_total,
                "avg_roi": (roi_total / closed) if closed > 0 else 0.0,
                "avg_rr": (rr_total / closed) if closed > 0 else 0.0,
                "pnl_total": pnl_total,
                "last_profit": float(metrics.get("last_profit", 0.0)),
                "recent_profit_mean": recent_profit_mean,
                "max_dd": self._compute_max_dd(alert_name),
            }
        return summary

    def record_trade_open(
        self,
        alert_name: str,
        symbol: str,
        side: str,
        size: float,
        signal_bundle: List[str],
        rr_planned: Optional[float] = None,
        entry_context: Optional[Dict[str, Any]] = None,
    ) -> int:
        trade_id = int(self.state.get("next_trade_id", 1))
        now = datetime.now(timezone.utc)
        self.state["next_trade_id"] = trade_id + 1
        self.state["trades"].append(
            {
                "trade_id": trade_id,
                "alert": alert_name,
                "symbol": symbol,
                "side": side,
                "size": float(size),
                "signal_bundle": signal_bundle,
                "result": "open",
                "win": None,
                "roi": None,
                "rr": rr_planned,
                "entry_context": entry_context or {},
                "time_slot_utc": now.hour,
                "opened_at": now.isoformat(),
                "closed_at": None,
            }
        )
        self._save_state()
        return trade_id

    def close_trade(self, trade_id: int, roi: float, rr: float) -> bool:
        for trade in self.state["trades"]:
            if int(trade.get("trade_id", -1)) != trade_id:
                continue
            if trade.get("result") != "open":
                return False
            trade["roi"] = float(roi)
            trade["rr"] = float(rr)
            trade["win"] = bool(roi > 0)
            trade["result"] = "win" if roi > 0 else "loss"
            trade["closed_at"] = datetime.now(timezone.utc).isoformat()

            alert_name = trade.get("alert", "")
            if alert_name not in self.state["alerts"]:
                self.state["alerts"][alert_name] = {
                    "weight": 1.0,
                    "closed": 0,
                    "wins": 0,
                    "roi_total": 0.0,
                    "rr_total": 0.0,
                }
            metrics = self.state["alerts"][alert_name]
            metrics["closed"] = int(metrics.get("closed", 0)) + 1
            metrics["wins"] = int(metrics.get("wins", 0)) + (1 if roi > 0 else 0)
            metrics["roi_total"] = float(metrics.get("roi_total", 0.0)) + float(roi)
            metrics["rr_total"] = float(metrics.get("rr_total", 0.0)) + float(rr)

            self._rebalance_weight(alert_name)
            self._save_state()
            return True
        return False

    def record_strategy_result(self, alert_name: str, profit: float) -> None:
        if alert_name not in self.state["alerts"]:
            self.state["alerts"][alert_name] = {
                "weight": 1.0,
                "closed": 0,
                "wins": 0,
                "roi_total": 0.0,
                "rr_total": 0.0,
                "pnl_total": 0.0,
                "last_profit": 0.0,
                "recent_profits": [],
            }

        metrics = self.state["alerts"][alert_name]
        metrics["pnl_total"] = float(metrics.get("pnl_total", 0.0)) + float(profit)
        metrics["last_profit"] = float(profit)

        recent = metrics.get("recent_profits", []) or []
        recent.append(float(profit))
        metrics["recent_profits"] = recent[-20:]
        self._save_state()

    def resize_open_trade(self, trade_id: int, new_size: float) -> bool:
        for trade in self.state["trades"]:
            if int(trade.get("trade_id", -1)) != int(trade_id):
                continue
            if trade.get("result") != "open":
                return False
            trade["size"] = max(0.0, float(new_size))
            self._save_state()
            return True
        return False

    def can_doten(self, symbol: str, cooldown_seconds: int) -> tuple[bool, int]:
        history = self.state.get("doten_history", {})
        last = history.get(symbol)
        if not last:
            return True, 0
        now_ts = int(time.time())
        elapsed = now_ts - int(last.get("timestamp", 0))
        remain = max(0, int(cooldown_seconds) - elapsed)
        return remain == 0, remain

    def record_doten(self, symbol: str, from_side: str, to_side: str, alert_name: str) -> None:
        if "doten_history" not in self.state:
            self.state["doten_history"] = {}
        self.state["doten_history"][symbol] = {
            "timestamp": int(time.time()),
            "from_side": from_side,
            "to_side": to_side,
            "alert": alert_name,
        }
        self._save_state()

    def _rebalance_weight(self, alert_name: str) -> None:
        metrics = self.state["alerts"][alert_name]
        closed = int(metrics.get("closed", 0))
        wins = int(metrics.get("wins", 0))
        roi_total = float(metrics.get("roi_total", 0.0))
        min_closed_for_weight = max(1, int(os.getenv("LEARNING_MIN_CLOSED_FOR_WEIGHT", "20")))
        max_weight_step = max(0.001, float(os.getenv("LEARNING_MAX_WEIGHT_STEP", "0.05")))
        smoothing_alpha = max(0.0, min(1.0, float(os.getenv("LEARNING_WEIGHT_SMOOTHING_ALPHA", "0.20"))))
        current_weight = float(metrics.get("weight", 1.0))
        if closed <= 0:
            metrics["weight"] = current_weight
            return
        win_rate = wins / closed
        avg_roi = roi_total / closed
        proposed = 0.2 + (win_rate * 0.9) + max(min(avg_roi, 0.2), -0.2)
        bounded_proposed = float(max(0.2, min(2.0, proposed)))

        confidence = min(1.0, closed / float(min_closed_for_weight))
        sample_adjusted_target = 1.0 + (bounded_proposed - 1.0) * confidence
        smoothed_target = ((1.0 - smoothing_alpha) * current_weight) + (smoothing_alpha * sample_adjusted_target)

        delta = smoothed_target - current_weight
        if delta > max_weight_step:
            next_weight = current_weight + max_weight_step
        elif delta < -max_weight_step:
            next_weight = current_weight - max_weight_step
        else:
            next_weight = smoothed_target

        metrics["weight"] = float(max(0.2, min(2.0, next_weight)))

    def _compute_max_dd(self, alert_name: str) -> float:
        curve = 0.0
        peak = 0.0
        max_dd = 0.0
        trades = [
            t for t in self.state.get("trades", [])
            if t.get("alert") == alert_name and t.get("result") in ("win", "loss")
        ]
        trades.sort(key=lambda t: str(t.get("closed_at") or t.get("opened_at") or ""))
        for trade in trades:
            curve += float(trade.get("roi") or 0.0)
            peak = max(peak, curve)
            dd = peak - curve
            max_dd = max(max_dd, dd)
        return float(max_dd)