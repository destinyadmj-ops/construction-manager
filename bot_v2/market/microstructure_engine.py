from dataclasses import dataclass

from bot_v2.models.market_snapshot import OrderBookFeatures


@dataclass(frozen=True)
class MicrostructureSignal:
    score: float
    confidence: float
    regime: str


class MarketMicrostructureEngine:
    def __init__(
        self,
        imbalance_weight: float = 0.45,
        flow_weight: float = 0.35,
        spread_penalty_weight: float = 0.20,
    ) -> None:
        self.imbalance_weight = imbalance_weight
        self.flow_weight = flow_weight
        self.spread_penalty_weight = spread_penalty_weight

    def evaluate(self, features: OrderBookFeatures) -> MicrostructureSignal:
        spread_penalty = min(max(features.spread_bps / 20.0, 0.0), 1.0)
        raw_score = (
            self.imbalance_weight * features.imbalance
            + self.flow_weight * (2.0 * features.aggressive_buy_ratio - 1.0)
            + self.spread_penalty_weight * (-spread_penalty)
        )
        score = max(min(raw_score, 1.0), -1.0)

        confidence = 0.4 + 0.6 * min(
            1.0,
            (abs(features.imbalance) + abs(2.0 * features.aggressive_buy_ratio - 1.0))
            / 2.0,
        )
        regime = self._classify_regime(features)
        return MicrostructureSignal(score=score, confidence=confidence, regime=regime)

    @staticmethod
    def _classify_regime(features: OrderBookFeatures) -> str:
        if features.spread_bps > 12.0:
            return "wide_spread"
        if features.top_depth_ratio < 0.8:
            return "thin_book"
        if abs(features.imbalance) > 0.35:
            return "trending_orderflow"
        return "balanced"
