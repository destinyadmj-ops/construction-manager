from dataclasses import dataclass
from itertools import permutations
from typing import Dict, List

from bot_v2.models.market_snapshot import MarketSnapshot, VenueQuote



@dataclass(frozen=True)
class ArbitrageOpportunity:
    buy_venue: str
    sell_venue: str
    gross_edge_bps: float
    net_edge_bps: float
    latency_penalty_bps: float
    executable: bool

    def to_dict(self) -> dict:
        return {
            "buy_venue": self.buy_venue,
            "sell_venue": self.sell_venue,
            "gross_edge_bps": float(self.gross_edge_bps),
            "net_edge_bps": float(self.net_edge_bps),
            "latency_penalty_bps": float(self.latency_penalty_bps),
            "executable": bool(self.executable),
        }


class CrossExchangeArbitrageEngine:
    def __init__(
        self,
        min_net_edge_bps: float = 4.0,
        latency_penalty_per_100ms_bps: float = 0.35,
        funding_penalty_scale: float = 1500.0,
    ) -> None:
        self.min_net_edge_bps = min_net_edge_bps
        self.latency_penalty_per_100ms_bps = latency_penalty_per_100ms_bps
        self.funding_penalty_scale = funding_penalty_scale

    def scan(self, snapshot: MarketSnapshot) -> List[dict]:
        venues = list(snapshot.venue_quotes.values())
        opportunities: List[ArbitrageOpportunity] = []
        for buy_quote, sell_quote in permutations(venues, 2):
            opportunity = self._evaluate_pair(
                buy_quote=buy_quote,
                sell_quote=sell_quote,
                funding_rate_8h=snapshot.funding_rate_8h,
            )
            if opportunity.net_edge_bps > 0.0:
                opportunities.append(opportunity)

        opportunities.sort(key=lambda item: item.net_edge_bps, reverse=True)
        # dict化して返す
        return [op.to_dict() for op in opportunities]

    def best(self, snapshot: MarketSnapshot) -> dict:
        opportunities = self.scan(snapshot)
        if not opportunities:
            return {}
        best = opportunities[0]
        return best

    def _evaluate_pair(
        self,
        buy_quote: VenueQuote,
        sell_quote: VenueQuote,
        funding_rate_8h: float,
    ) -> ArbitrageOpportunity:
        gross_edge_bps = ((sell_quote.bid - buy_quote.ask) / buy_quote.ask) * 10_000.0

        execution_cost_bps = (
            buy_quote.taker_fee_bps
            + sell_quote.taker_fee_bps
            + buy_quote.est_slippage_bps
            + sell_quote.est_slippage_bps
        )
        latency_penalty_bps = (
            ((buy_quote.latency_ms + sell_quote.latency_ms) / 100.0)
            * self.latency_penalty_per_100ms_bps
        )
        funding_penalty_bps = abs(funding_rate_8h) * self.funding_penalty_scale

        net_edge_bps = (
            gross_edge_bps
            - execution_cost_bps
            - latency_penalty_bps
            - funding_penalty_bps
        )
        executable = net_edge_bps >= self.min_net_edge_bps
        return ArbitrageOpportunity(
            buy_venue=buy_quote.venue,
            sell_venue=sell_quote.venue,
            gross_edge_bps=gross_edge_bps,
            net_edge_bps=net_edge_bps,
            latency_penalty_bps=latency_penalty_bps,
            executable=executable,
        )

    @staticmethod
    def summarize_by_venue(opportunities: List[dict]) -> Dict[str, float]:
        scores: Dict[str, float] = {}
        for item in opportunities:
            key = f"{item['buy_venue']}->{item['sell_venue']}"
            scores[key] = float(item["net_edge_bps"])
        return scores
