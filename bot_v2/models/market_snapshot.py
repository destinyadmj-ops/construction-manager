from dataclasses import dataclass
from typing import Dict


@dataclass(frozen=True)
class VenueQuote:
    venue: str
    bid: float
    ask: float
    taker_fee_bps: float
    maker_fee_bps: float
    est_slippage_bps: float
    latency_ms: float


@dataclass(frozen=True)
class OrderBookFeatures:
    spread_bps: float
    imbalance: float
    top_depth_ratio: float
    aggressive_buy_ratio: float


@dataclass(frozen=True)
class MarketSnapshot:
    symbol: str
    mid_price: float
    funding_rate_8h: float
    volatility_1m: float
    features: OrderBookFeatures
    venue_quotes: Dict[str, VenueQuote]
