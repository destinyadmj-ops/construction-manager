import hashlib
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import bot_v2.config as cfg


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
            "observations": [],
            "observation_stats": {},
            "next_observation_id": 1,
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
            observation_bucket = self.state.get("observation_stats", {}).get(self._observation_bucket_key(alert_name, "global"), {})
            observation_resolved = int(observation_bucket.get("resolved", 0))
            observation_wins = int(observation_bucket.get("wins", 0))
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
                "observation_resolved": observation_resolved,
                "observation_win_rate": (observation_wins / observation_resolved) if observation_resolved > 0 else 0.0,
                "observation_bias": self.get_observation_bias(alert_name),
                "observation_victory_score": self._estimate_bucket_victory_score(
                    observation_bucket,
                    self._int_setting("OBSERVATION_BIAS_MIN_SAMPLES", cfg.OBSERVATION_BIAS_MIN_SAMPLES, 3),
                ),
            }
        return summary

    def get_observation_summary(self, recent_limit: int = 8, compact: bool = False) -> Dict[str, Any]:
        observations = list(self.state.get("observations", []) or [])
        pending = [item for item in observations if str(item.get("status") or "") == "pending"]
        resolved = [item for item in observations if str(item.get("status") or "") == "resolved"]
        stats = self.state.get("observation_stats", {}) or {}

        per_alert: Dict[str, Dict[str, Any]] = {}
        for alert_name in ("alert_a", "alert_b", "alert_c", "alert_d"):
            bucket = stats.get(self._observation_bucket_key(alert_name, "global"), {}) or {}
            resolved_count = int(bucket.get("resolved", 0))
            wins = int(bucket.get("wins", 0))
            edge_total = float(bucket.get("edge_total", 0.0))
            per_alert[alert_name] = {
                "resolved": resolved_count,
                "wins": wins,
                "win_rate": (wins / resolved_count) if resolved_count > 0 else 0.0,
                "avg_edge": (edge_total / resolved_count) if resolved_count > 0 else 0.0,
                "bias": self.get_observation_bias(alert_name),
                "victory_score": self._estimate_bucket_victory_score(bucket, self._int_setting("OBSERVATION_BIAS_MIN_SAMPLES", cfg.OBSERVATION_BIAS_MIN_SAMPLES, 3)),
            }

        payload = {
            "totals": {
                "observations": len(observations),
                "pending": len(pending),
                "resolved": len(resolved),
            },
            "config": self.get_observation_config(),
            "per_alert": per_alert,
            "context_scopes": {
                "symbol": self._scope_observation_summary("symbol"),
                "regime": self._scope_observation_summary("regime"),
                "alignment": self._scope_observation_summary("alignment"),
                "timeframe_bias": self._scope_observation_summary("timeframe_bias"),
                "style": self._scope_observation_summary("style"),
                "source_family": self._scope_observation_summary("source_family"),
                "threshold_state": self._scope_observation_summary("threshold_state"),
            },
            "representative_contexts": self._representative_contexts(),
        }
        if compact:
            return payload

        recent_resolved = sorted(
            resolved,
            key=lambda item: int(item.get("resolved_ts", 0) or 0),
            reverse=True,
        )[: max(1, int(recent_limit))]
        payload["recent_resolved"] = recent_resolved
        return payload

    def get_observation_config(self) -> Dict[str, Any]:
        return {
            "learn_horizon_seconds": self._int_setting("OBSERVATION_LEARN_HORIZON_SECONDS", cfg.OBSERVATION_LEARN_HORIZON_SECONDS, 60),
            "max_records": self._int_setting("OBSERVATION_MAX_RECORDS", cfg.OBSERVATION_MAX_RECORDS, 200),
            "duplicate_cooldown_seconds": self._int_setting("OBSERVATION_DUPLICATE_COOLDOWN_SECONDS", cfg.OBSERVATION_DUPLICATE_COOLDOWN_SECONDS, 30),
            "min_move_ratio": self._float_setting("OBSERVATION_MIN_MOVE_RATIO", cfg.OBSERVATION_MIN_MOVE_RATIO, 0.0001),
            "bias_min_samples": self._int_setting("OBSERVATION_BIAS_MIN_SAMPLES", cfg.OBSERVATION_BIAS_MIN_SAMPLES, 3),
            "max_score_bias": self._float_setting("OBSERVATION_MAX_SCORE_BIAS", cfg.OBSERVATION_MAX_SCORE_BIAS, 0.01),
        }

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

    def record_market_observation(
        self,
        symbol: str,
        bot_eval: Dict[str, Any],
        source: str = "runtime",
        current_price: Optional[float] = None,
        executed: bool = False,
    ) -> List[int]:
        if not isinstance(bot_eval, dict):
            return []

        price = float(current_price or self._extract_observation_price(bot_eval) or 0.0)
        if price <= 0.0:
            return []

        candidates = bot_eval.get("candidates") if isinstance(bot_eval.get("candidates"), list) else []
        if not candidates and bot_eval.get("selected_alert") and str(bot_eval.get("signal") or "").upper() in ("BUY", "SELL"):
            candidates = [{
                "alert": bot_eval.get("selected_alert"),
                "side": "buy" if str(bot_eval.get("signal") or "").upper() == "BUY" else "sell",
                "score": float(bot_eval.get("score", 0.0) or 0.0),
                "confidence": float(bot_eval.get("confidence", 0.0) or 0.0),
            }]

        if not candidates:
            return []

        now_ts = int(time.time())
        horizon_seconds = self._int_setting("OBSERVATION_LEARN_HORIZON_SECONDS", cfg.OBSERVATION_LEARN_HORIZON_SECONDS, 60)
        max_observations = self._int_setting("OBSERVATION_MAX_RECORDS", cfg.OBSERVATION_MAX_RECORDS, 200)
        duplicate_cooldown = self._int_setting("OBSERVATION_DUPLICATE_COOLDOWN_SECONDS", cfg.OBSERVATION_DUPLICATE_COOLDOWN_SECONDS, 30)
        observation_ids: List[int] = []

        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            alert_name = self._normalize_alert_name(candidate.get("alert"))
            side = str(candidate.get("side") or "").lower()
            if side not in ("buy", "sell"):
                continue

            context = self._build_observation_context(
                symbol=symbol,
                bot_eval=bot_eval,
                alert_name=alert_name,
                candidate=candidate,
                source=source,
            )
            context_hash = self._observation_context_hash(context)
            if self._has_recent_duplicate_observation(symbol, alert_name, side, context_hash, duplicate_cooldown, now_ts):
                continue

            observation_id = int(self.state.get("next_observation_id", 1))
            self.state["next_observation_id"] = observation_id + 1
            self.state.setdefault("observations", []).append(
                {
                    "observation_id": observation_id,
                    "symbol": str(symbol or "").upper(),
                    "alert": alert_name,
                    "side": side,
                    "source": str(source or "runtime"),
                    "status": "resolved" if executed else "pending",
                    "observed_price": price,
                    "score": float(candidate.get("score", 0.0) or 0.0),
                    "confidence": float(candidate.get("confidence", 0.0) or 0.0),
                    "context": context,
                    "context_hash": context_hash,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "created_ts": now_ts,
                    "resolve_after_ts": now_ts if executed else (now_ts + horizon_seconds),
                    "executed": bool(executed),
                }
            )
            observation_ids.append(observation_id)

        if len(self.state.get("observations", [])) > max_observations:
            self.state["observations"] = self.state["observations"][-max_observations:]

        if observation_ids:
            self._save_state()
        return observation_ids

    def resolve_market_observations(self, latest_prices: Dict[str, float], now_ts: Optional[int] = None) -> int:
        observations = self.state.get("observations", []) or []
        if not observations:
            return 0

        resolved = 0
        now_ts = int(now_ts or time.time())
        move_threshold = self._float_setting("OBSERVATION_MIN_MOVE_RATIO", cfg.OBSERVATION_MIN_MOVE_RATIO, 0.0001)

        for observation in observations:
            if str(observation.get("status") or "") != "pending":
                continue
            if int(observation.get("resolve_after_ts", 0) or 0) > now_ts:
                continue

            symbol = str(observation.get("symbol") or "").upper()
            current_price = float(latest_prices.get(symbol) or 0.0)
            entry_price = float(observation.get("observed_price") or 0.0)
            if current_price <= 0.0 or entry_price <= 0.0:
                continue

            raw_move = (current_price - entry_price) / entry_price
            signed_move = raw_move if str(observation.get("side") or "").lower() == "buy" else -raw_move
            win = signed_move > move_threshold
            quality = signed_move
            observation["status"] = "resolved"
            observation["resolved_at"] = datetime.now(timezone.utc).isoformat()
            observation["resolved_ts"] = now_ts
            observation["resolved_price"] = current_price
            observation["realized_move_ratio"] = float(signed_move)
            observation["win"] = bool(win)
            self._accumulate_observation_stat(observation, quality, win)
            resolved += 1

        if resolved > 0:
            self._save_state()
        return resolved

    def get_observation_bias(
        self,
        alert_name: str,
        symbol: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> float:
        alert_name = self._normalize_alert_name(alert_name)
        stats = self.state.get("observation_stats", {}) or {}
        min_samples = self._int_setting("OBSERVATION_BIAS_MIN_SAMPLES", cfg.OBSERVATION_BIAS_MIN_SAMPLES, 3)
        max_bias = self._float_setting("OBSERVATION_MAX_SCORE_BIAS", cfg.OBSERVATION_MAX_SCORE_BIAS, 0.01)
        requested_context = context or {}

        scoped_keys = [
            (self._observation_bucket_key(alert_name, "global"), 0.45),
            (self._observation_bucket_key(alert_name, "symbol", str(symbol or requested_context.get("symbol") or "").upper()), 0.25),
            (self._observation_bucket_key(alert_name, "regime", str(requested_context.get("regime") or "unknown")), 0.20),
            (self._observation_bucket_key(alert_name, "alignment", str(requested_context.get("alignment") or "mixed")), 0.10),
            (self._observation_bucket_key(alert_name, "timeframe_bias", str(requested_context.get("timeframe_bias") or "unknown")), 0.08),
            (self._observation_bucket_key(alert_name, "style", str(requested_context.get("style") or "unknown")), 0.06),
            (self._observation_bucket_key(alert_name, "source_family", str(requested_context.get("source_family") or "runtime")), 0.04),
            (self._observation_bucket_key(alert_name, "threshold_state", str(requested_context.get("threshold_state") or "unknown")), 0.04),
        ]

        total_weight = 0.0
        weighted_bias = 0.0
        for key, scope_weight in scoped_keys:
            if not key:
                continue
            bucket = stats.get(key) or {}
            resolved = int(bucket.get("resolved", 0))
            if resolved <= 0:
                continue
            confidence = min(1.0, resolved / float(min_samples))
            component = self._estimate_bucket_component(bucket)
            total_weight += scope_weight * confidence
            weighted_bias += component * scope_weight * confidence

        if total_weight <= 0.0:
            return 0.0
        return float(max(-max_bias, min(max_bias, weighted_bias / total_weight)))

    def get_observation_threshold_adjustment(
        self,
        alert_name: str,
        symbol: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> float:
        max_adjustment = self._float_setting(
            "OBSERVATION_MAX_THRESHOLD_ADJUSTMENT",
            getattr(cfg, "OBSERVATION_MAX_THRESHOLD_ADJUSTMENT", 0.03),
            0.0,
        )
        bias = self.get_observation_bias(alert_name, symbol=symbol, context=context)
        adjustment = -bias * 0.75
        return float(max(-max_adjustment, min(max_adjustment, adjustment)))

    def get_observation_context_signal(
        self,
        alert_name: str,
        symbol: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        alert_name = self._normalize_alert_name(alert_name)
        requested_context = dict(context or {})
        normalized_symbol = str(symbol or requested_context.get("symbol") or "").upper()
        min_samples = self._int_setting("OBSERVATION_BIAS_MIN_SAMPLES", cfg.OBSERVATION_BIAS_MIN_SAMPLES, 3)
        max_threshold_adjustment = self._float_setting(
            "OBSERVATION_MAX_THRESHOLD_ADJUSTMENT",
            getattr(cfg, "OBSERVATION_MAX_THRESHOLD_ADJUSTMENT", 0.03),
            0.0,
        )

        scope_requests = {
            "global": None,
            "symbol": normalized_symbol,
            "regime": str(requested_context.get("regime") or "unknown"),
            "alignment": str(requested_context.get("alignment") or "mixed"),
            "timeframe_bias": str(requested_context.get("timeframe_bias") or "unknown"),
            "style": str(requested_context.get("style") or "unknown"),
            "source_family": str(requested_context.get("source_family") or "runtime"),
            "threshold_state": str(requested_context.get("threshold_state") or "unknown"),
        }

        scopes: Dict[str, Dict[str, Any]] = {}
        stats = self.state.get("observation_stats", {}) or {}
        for scope_name, scope_value in scope_requests.items():
            key = self._observation_bucket_key(alert_name, scope_name, scope_value) if scope_value is not None else self._observation_bucket_key(alert_name, scope_name)
            bucket = stats.get(key) or {}
            resolved = int(bucket.get("resolved", 0) or 0)
            wins = int(bucket.get("wins", 0) or 0)
            edge_total = float(bucket.get("edge_total", 0.0) or 0.0)
            estimated_bias = self._estimate_bucket_bias(bucket, min_samples)
            victory_score = self._estimate_bucket_victory_score(bucket, min_samples)
            estimated_threshold_adjustment = float(
                max(-max_threshold_adjustment, min(max_threshold_adjustment, -estimated_bias * 0.75))
            ) if resolved > 0 else 0.0
            scopes[scope_name] = {
                "value": scope_value if scope_value is not None else "global",
                "resolved": resolved,
                "win_rate": (wins / resolved) if resolved > 0 else 0.0,
                "avg_edge": (edge_total / resolved) if resolved > 0 else 0.0,
                "estimated_bias": estimated_bias,
                "estimated_threshold_adjustment": estimated_threshold_adjustment,
                "victory_score": victory_score,
                "is_victory_reference": bool(victory_score >= 0.035 and resolved >= max(2, min_samples - 1)),
            }

        victory_reference = self.get_victory_reference(alert_name, symbol=normalized_symbol, context=requested_context)
        return {
            "alert": alert_name,
            "symbol": normalized_symbol,
            "bias": self.get_observation_bias(alert_name, symbol=normalized_symbol, context=requested_context),
            "threshold_adjustment": self.get_observation_threshold_adjustment(alert_name, symbol=normalized_symbol, context=requested_context),
            "victory_score": self._aggregate_victory_score(scopes),
            "victory_reference": victory_reference,
            "scopes": scopes,
        }

    def get_victory_reference(
        self,
        alert_name: str,
        symbol: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        signal = context or {}
        scoped_reference: List[Dict[str, Any]] = []
        scope_map = {
            "symbol": str(symbol or signal.get("symbol") or "").upper(),
            "regime": str(signal.get("regime") or "unknown"),
            "alignment": str(signal.get("alignment") or "mixed"),
            "timeframe_bias": str(signal.get("timeframe_bias") or "unknown"),
            "style": str(signal.get("style") or "unknown"),
            "source_family": str(signal.get("source_family") or "runtime"),
            "threshold_state": str(signal.get("threshold_state") or "unknown"),
        }
        min_samples = self._int_setting("OBSERVATION_BIAS_MIN_SAMPLES", cfg.OBSERVATION_BIAS_MIN_SAMPLES, 3)
        stats = self.state.get("observation_stats", {}) or {}
        normalized_alert = self._normalize_alert_name(alert_name)

        for scope_name, scope_value in scope_map.items():
            if not scope_value:
                continue
            bucket = stats.get(self._observation_bucket_key(normalized_alert, scope_name, scope_value)) or {}
            resolved = int(bucket.get("resolved", 0) or 0)
            if resolved <= 0:
                continue
            wins = int(bucket.get("wins", 0) or 0)
            avg_edge = float(bucket.get("edge_total", 0.0) or 0.0) / float(resolved)
            victory_score = self._estimate_bucket_victory_score(bucket, min_samples)
            scoped_reference.append(
                {
                    "scope": scope_name,
                    "value": scope_value,
                    "resolved": resolved,
                    "wins": wins,
                    "win_rate": (wins / resolved) if resolved > 0 else 0.0,
                    "avg_edge": avg_edge,
                    "victory_score": victory_score,
                }
            )

        scoped_reference.sort(
            key=lambda item: (
                float(item.get("victory_score", 0.0)),
                float(item.get("win_rate", 0.0)),
                int(item.get("resolved", 0)),
            ),
            reverse=True,
        )
        top_references = scoped_reference[:3]
        return {
            "matched_scopes": top_references,
            "top_reference": top_references[0] if top_references else None,
            "victory_score": float(top_references[0].get("victory_score", 0.0)) if top_references else 0.0,
        }

    def _aggregate_victory_score(self, scopes: Dict[str, Dict[str, Any]]) -> float:
        weights = {
            "global": 0.28,
            "symbol": 0.22,
            "regime": 0.18,
            "alignment": 0.08,
            "timeframe_bias": 0.08,
            "style": 0.06,
            "source_family": 0.06,
            "threshold_state": 0.04,
        }
        total_weight = 0.0
        weighted_score = 0.0
        for scope_name, scope_weight in weights.items():
            scope = scopes.get(scope_name) or {}
            resolved = int(scope.get("resolved", 0) or 0)
            if resolved <= 0:
                continue
            weighted_score += float(scope.get("victory_score", 0.0) or 0.0) * scope_weight
            total_weight += scope_weight
        if total_weight <= 0.0:
            return 0.0
        return float(weighted_score / total_weight)

    def _estimate_bucket_component(self, bucket: Dict[str, Any]) -> float:
        resolved = int(bucket.get("resolved", 0) or 0)
        if resolved <= 0:
            return 0.0
        win_rate = int(bucket.get("wins", 0) or 0) / float(resolved)
        avg_edge = float(bucket.get("edge_total", 0.0) or 0.0) / float(resolved)
        positive_component = max(0.0, win_rate - 0.5) * 0.24
        positive_component += max(0.0, min(0.05, avg_edge * 10.0))
        caution_component = min(0.0, win_rate - 0.5) * 0.10
        caution_component += min(0.0, max(-0.03, avg_edge * 6.0))
        return float(positive_component + caution_component)

    def _estimate_bucket_bias(self, bucket: Dict[str, Any], min_samples: int) -> float:
        resolved = int(bucket.get("resolved", 0) or 0)
        if resolved <= 0:
            return 0.0
        confidence = min(1.0, resolved / float(max(1, min_samples)))
        component = self._estimate_bucket_component(bucket)
        return float(component * confidence)

    def _estimate_bucket_victory_score(self, bucket: Dict[str, Any], min_samples: int) -> float:
        resolved = int(bucket.get("resolved", 0) or 0)
        if resolved <= 0:
            return 0.0
        confidence = min(1.0, resolved / float(max(1, min_samples)))
        wins = int(bucket.get("wins", 0) or 0)
        win_rate = wins / float(resolved)
        avg_edge = float(bucket.get("edge_total", 0.0) or 0.0) / float(resolved)
        win_component = max(0.0, win_rate - 0.5) * 1.8
        edge_component = max(0.0, min(0.12, avg_edge * 10.0))
        return float((win_component + edge_component) * confidence)

    def apply_observation_bias(self, bot_eval: Dict[str, Any], symbol: Optional[str] = None) -> Dict[str, Any]:
        if not isinstance(bot_eval, dict):
            return bot_eval
        candidates = bot_eval.get("candidates") if isinstance(bot_eval.get("candidates"), list) else []
        if not candidates:
            return bot_eval

        adjusted_eval = dict(bot_eval)
        adjusted_candidates: List[Dict[str, Any]] = []
        observation_biases: Dict[str, float] = {}
        observation_victory_scores: Dict[str, float] = {}
        observation_victory_references: Dict[str, Dict[str, Any]] = {}
        thresholds: Dict[str, Any] = dict(adjusted_eval.get("thresholds") or {}) if isinstance(adjusted_eval.get("thresholds"), dict) else {}

        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            alert_name = self._normalize_alert_name(candidate.get("alert"))
            context = self._build_observation_context(symbol or "", bot_eval, alert_name, candidate, "runtime")
            bias = self.get_observation_bias(alert_name, symbol=symbol, context=context)
            context_signal = self.get_observation_context_signal(alert_name, symbol=symbol, context=context)
            victory_score = float(context_signal.get("victory_score", 0.0) or 0.0)
            victory_reference = context_signal.get("victory_reference") if isinstance(context_signal.get("victory_reference"), dict) else {}
            matched_scopes = victory_reference.get("matched_scopes") if isinstance(victory_reference.get("matched_scopes"), list) else []
            top_reference = victory_reference.get("top_reference") if isinstance(victory_reference.get("top_reference"), dict) else {}
            score_before_observation = float(candidate.get("score", 0.0) or 0.0)
            score_after_observation = max(0.0, score_before_observation + bias)
            victory_bonus = min(0.035, max(0.0, victory_score) * 0.028)
            reference_bonus = min(0.010, 0.0025 * len(matched_scopes))
            if int(top_reference.get("resolved", 0) or 0) >= 5 and float(top_reference.get("win_rate", 0.0) or 0.0) >= 0.6:
                reference_bonus += 0.004
            entry_selection_score = score_after_observation + victory_bonus + min(0.012, reference_bonus)
            updated = dict(candidate)
            updated["score_before_observation"] = score_before_observation
            updated["observation_bias"] = float(bias)
            updated["context_signal"] = context_signal
            updated["victory_score"] = victory_score
            updated["victory_reference"] = victory_reference
            updated["score"] = score_after_observation
            updated["entry_selection_score"] = float(entry_selection_score)
            updated["entry_selection_bonus"] = float(entry_selection_score - score_after_observation)
            adjusted_candidates.append(updated)
            observation_biases[alert_name] = float(bias)
            observation_victory_scores[alert_name] = float(victory_score)
            observation_victory_references[alert_name] = victory_reference

        if not adjusted_candidates:
            return bot_eval

        best = max(
            adjusted_candidates,
            key=lambda item: (
                float(item.get("entry_selection_score", 0.0) or 0.0),
                float(item.get("score", 0.0) or 0.0),
                float(item.get("confidence", 0.0) or 0.0),
            ),
        )
        selected_alert = self._normalize_alert_name(best.get("alert"))
        threshold = float(thresholds.get(selected_alert, 0.0) or 0.0)

        adjusted_eval["candidates"] = adjusted_candidates
        adjusted_eval["observation_biases"] = observation_biases
        adjusted_eval["observation_victory_scores"] = observation_victory_scores
        adjusted_eval["observation_victory_references"] = observation_victory_references
        adjusted_eval["score"] = float(best.get("score", 0.0) or 0.0)
        adjusted_eval["confidence"] = float(best.get("confidence", adjusted_eval.get("confidence", 0.0)) or 0.0)
        adjusted_eval["entry_selection_score"] = float(best.get("entry_selection_score", adjusted_eval["score"]) or adjusted_eval["score"])
        adjusted_eval["entry_selection_bonus"] = float(best.get("entry_selection_bonus", 0.0) or 0.0)
        adjusted_eval["victory_score"] = float(best.get("victory_score", 0.0) or 0.0)
        adjusted_eval["victory_reference"] = best.get("victory_reference", {}) if isinstance(best.get("victory_reference"), dict) else {}

        if adjusted_eval["score"] >= threshold and str(best.get("side") or "").lower() in ("buy", "sell"):
            adjusted_eval["selected_alert"] = selected_alert
            adjusted_eval["signal"] = "BUY" if str(best.get("side") or "").lower() == "buy" else "SELL"
            adjusted_eval["selected_style"] = str(best.get("style") or adjusted_eval.get("selected_style") or "breakout")
            adjusted_eval["selection_reason"] = "victory_context_re_ranked"
            if str(adjusted_eval.get("no_signal_reason") or "").startswith("score_below_threshold"):
                adjusted_eval["no_signal_reason"] = None
        elif adjusted_candidates and not adjusted_eval.get("signal"):
            adjusted_eval["no_signal_reason"] = f"victory_context_score_below_threshold:{selected_alert}"

        return adjusted_eval

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

    @staticmethod
    def _normalize_alert_name(value: Any) -> str:
        alert_name = str(value or "alert_d").strip().lower()
        return alert_name if alert_name in ("alert_a", "alert_b", "alert_c", "alert_d") else "alert_d"

    @staticmethod
    def _extract_observation_price(bot_eval: Dict[str, Any]) -> float:
        multi_timeframes: Dict[str, Any] = dict(bot_eval.get("multi_timeframes") or {}) if isinstance(bot_eval.get("multi_timeframes"), dict) else {}
        for timeframe in ("1m", "5m", "10m", "15m", "30m", "1h", "1d"):
            item = multi_timeframes.get(timeframe)
            if isinstance(item, dict):
                price = float(item.get("close", 0.0) or 0.0)
                if price > 0.0:
                    return price
        return 0.0

    def _build_observation_context(
        self,
        symbol: str,
        bot_eval: Dict[str, Any],
        alert_name: str,
        candidate: Dict[str, Any],
        source: str,
    ) -> Dict[str, Any]:
        all_results = bot_eval.get("all_results") if isinstance(bot_eval.get("all_results"), dict) else {}
        alert_result = all_results.get(alert_name) if isinstance(all_results, dict) else {}
        multi_timeframes = bot_eval.get("multi_timeframes") if isinstance(bot_eval.get("multi_timeframes"), dict) else {}
        side = str(candidate.get("side") or "").lower()
        regime = "unknown"
        source_name = str(source or "runtime")
        threshold_map: Dict[str, Any] = dict(bot_eval.get("thresholds") or {}) if isinstance(bot_eval.get("thresholds"), dict) else {}
        score_value = float(candidate.get("score", 0.0) or 0.0)
        threshold_value = float(threshold_map.get(alert_name, candidate.get("threshold", 0.0)) or 0.0)
        if isinstance(alert_result, dict):
            regime = str(alert_result.get("market_regime") or alert_result.get("trend_regime") or regime)

        timeframe_alignment = self._timeframe_alignment(multi_timeframes, side)
        return {
            "symbol": str(symbol or "").upper(),
            "alert": self._normalize_alert_name(alert_name),
            "side": side,
            "regime": regime,
            "alignment": timeframe_alignment,
            "source": source_name,
            "source_family": self._normalize_observation_source_family(source_name),
            "style": str(candidate.get("style") or bot_eval.get("selected_style") or "unknown"),
            "timeframe_bias": self._timeframe_bias(multi_timeframes),
            "threshold_state": self._threshold_state(score_value, threshold_value),
        }

    @staticmethod
    def _timeframe_alignment(multi_timeframes: Dict[str, Any], side: str) -> str:
        if not isinstance(multi_timeframes, dict):
            return "mixed"
        positive = 0
        negative = 0
        for timeframe in ("1m", "5m", "10m", "15m", "30m", "1h", "1d"):
            row = multi_timeframes.get(timeframe)
            if not isinstance(row, dict):
                continue
            trend = float(row.get("trend", 0.0) or 0.0)
            if trend > 0:
                positive += 1
            elif trend < 0:
                negative += 1
        if side == "buy":
            if positive >= 3:
                return "aligned"
            if negative >= 3:
                return "counter"
        if side == "sell":
            if negative >= 3:
                return "aligned"
            if positive >= 3:
                return "counter"
        return "mixed"

    @staticmethod
    def _timeframe_bias(multi_timeframes: Dict[str, Any]) -> str:
        if not isinstance(multi_timeframes, dict):
            return "unknown"
        atr_values = [float(item.get("atr", 0.0) or 0.0) for item in multi_timeframes.values() if isinstance(item, dict)]
        if not atr_values:
            return "unknown"
        avg_atr = sum(atr_values) / len(atr_values)
        if avg_atr > 0.02:
            return "expansion"
        if avg_atr > 0.005:
            return "normal"
        return "compression"

    @staticmethod
    def _normalize_observation_source_family(source: str) -> str:
        raw = str(source or "runtime").strip().lower()
        if not raw:
            return "runtime"
        return raw.split("_", 1)[0]

    @staticmethod
    def _threshold_state(score: float, threshold: float) -> str:
        if threshold <= 0.0:
            return "open"
        margin = float(score) - float(threshold)
        if margin >= 0.02:
            return "clear"
        if margin >= 0.0:
            return "near"
        return "below"

    @staticmethod
    def _observation_context_hash(context: Dict[str, Any]) -> str:
        payload = json.dumps(context, ensure_ascii=False, sort_keys=True)
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]

    def _has_recent_duplicate_observation(
        self,
        symbol: str,
        alert_name: str,
        side: str,
        context_hash: str,
        cooldown_seconds: int,
        now_ts: int,
    ) -> bool:
        for observation in reversed(self.state.get("observations", []) or []):
            if str(observation.get("symbol") or "") != str(symbol or "").upper():
                continue
            if str(observation.get("alert") or "") != alert_name:
                continue
            if str(observation.get("side") or "") != side:
                continue
            if str(observation.get("context_hash") or "") != context_hash:
                continue
            created_ts = int(observation.get("created_ts", 0) or 0)
            return (now_ts - created_ts) < cooldown_seconds
        return False

    @staticmethod
    def _observation_bucket_key(alert_name: str, scope: str, value: Optional[str] = None) -> str:
        normalized_alert = AlertLearningEngine._normalize_alert_name(alert_name)
        if value is None:
            return f"{normalized_alert}|{scope}"
        value_str = str(value or "").strip().lower()
        return f"{normalized_alert}|{scope}:{value_str}"

    def _accumulate_observation_stat(self, observation: Dict[str, Any], quality: float, win: bool) -> None:
        stats = self.state.setdefault("observation_stats", {})
        alert_name = self._normalize_alert_name(observation.get("alert"))
        context: Dict[str, Any] = dict(observation.get("context") or {}) if isinstance(observation.get("context"), dict) else {}
        keys = [
            self._observation_bucket_key(alert_name, "global"),
            self._observation_bucket_key(alert_name, "symbol", observation.get("symbol")),
            self._observation_bucket_key(alert_name, "regime", context.get("regime")),
            self._observation_bucket_key(alert_name, "alignment", context.get("alignment")),
            self._observation_bucket_key(alert_name, "timeframe_bias", context.get("timeframe_bias")),
            self._observation_bucket_key(alert_name, "style", context.get("style")),
            self._observation_bucket_key(alert_name, "source_family", context.get("source_family")),
            self._observation_bucket_key(alert_name, "threshold_state", context.get("threshold_state")),
        ]

        for key in keys:
            bucket = stats.setdefault(
                key,
                {
                    "resolved": 0,
                    "wins": 0,
                    "edge_total": 0.0,
                    "score_total": 0.0,
                    "confidence_total": 0.0,
                    "last_edge": 0.0,
                    "last_resolved_at": None,
                },
            )
            bucket["resolved"] = int(bucket.get("resolved", 0)) + 1
            bucket["wins"] = int(bucket.get("wins", 0)) + (1 if win else 0)
            bucket["edge_total"] = float(bucket.get("edge_total", 0.0)) + float(quality)
            bucket["score_total"] = float(bucket.get("score_total", 0.0)) + float(observation.get("score", 0.0) or 0.0)
            bucket["confidence_total"] = float(bucket.get("confidence_total", 0.0)) + float(observation.get("confidence", 0.0) or 0.0)
            bucket["last_edge"] = float(quality)
            bucket["last_resolved_at"] = datetime.now(timezone.utc).isoformat()

    def _scope_observation_summary(self, scope: str, limit: int = 5) -> List[Dict[str, Any]]:
        stats = self.state.get("observation_stats", {}) or {}
        rows: List[Dict[str, Any]] = []
        prefix = f"|{scope}:"
        min_samples = self._int_setting("OBSERVATION_BIAS_MIN_SAMPLES", cfg.OBSERVATION_BIAS_MIN_SAMPLES, 3)
        max_threshold_adjustment = self._float_setting(
            "OBSERVATION_MAX_THRESHOLD_ADJUSTMENT",
            getattr(cfg, "OBSERVATION_MAX_THRESHOLD_ADJUSTMENT", 0.03),
            0.0,
        )
        for key, bucket in stats.items():
            if prefix not in key:
                continue
            alert_name, scoped_value = str(key).split("|", 1)
            _, value = scoped_value.split(":", 1)
            resolved = int(bucket.get("resolved", 0) or 0)
            if resolved <= 0:
                continue
            wins = int(bucket.get("wins", 0) or 0)
            edge_total = float(bucket.get("edge_total", 0.0) or 0.0)
            estimated_bias = self._estimate_bucket_bias(bucket, min_samples)
            estimated_threshold_adjustment = float(
                max(-max_threshold_adjustment, min(max_threshold_adjustment, -estimated_bias * 0.75))
            )
            rows.append(
                {
                    "alert": alert_name,
                    "value": value,
                    "resolved": resolved,
                    "win_rate": (wins / resolved) if resolved > 0 else 0.0,
                    "avg_edge": (edge_total / resolved) if resolved > 0 else 0.0,
                    "last_edge": float(bucket.get("last_edge", 0.0) or 0.0),
                    "estimated_bias": estimated_bias,
                    "estimated_threshold_adjustment": estimated_threshold_adjustment,
                    "victory_score": self._estimate_bucket_victory_score(bucket, min_samples),
                }
            )

        rows.sort(
            key=lambda item: (
                float(item.get("victory_score", 0.0)),
                float(item.get("win_rate", 0.0)),
                int(item.get("resolved", 0)),
                float(item.get("avg_edge", 0.0)),
            ),
            reverse=True,
        )
        return rows[: max(1, int(limit))]

    def _representative_contexts(self) -> Dict[str, Dict[str, Any]]:
        contexts: Dict[str, Dict[str, Any]] = {}
        for alert_name in ("alert_a", "alert_b", "alert_c", "alert_d"):
            contexts[alert_name] = {
                "regime": next((row for row in self._scope_observation_summary("regime", limit=20) if str(row.get("alert")) == alert_name), None),
                "source_family": next((row for row in self._scope_observation_summary("source_family", limit=20) if str(row.get("alert")) == alert_name), None),
                "threshold_state": next((row for row in self._scope_observation_summary("threshold_state", limit=20) if str(row.get("alert")) == alert_name), None),
                "style": next((row for row in self._scope_observation_summary("style", limit=20) if str(row.get("alert")) == alert_name), None),
            }
        return contexts

    @staticmethod
    def _int_setting(env_name: str, default: int, minimum: int) -> int:
        try:
            value = int(os.getenv(env_name, str(default)))
        except Exception:
            value = int(default)
        return max(int(minimum), value)

    @staticmethod
    def _float_setting(env_name: str, default: float, minimum: float) -> float:
        try:
            value = float(os.getenv(env_name, str(default)))
        except Exception:
            value = float(default)
        return max(float(minimum), value)

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