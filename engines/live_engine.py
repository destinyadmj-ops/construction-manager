import asyncio
from rl.inference import get_action
from exchange.bitget_api import place_order

class LiveEngine:
    def __init__(self, ws):
        self.ws = ws
        self.balance = 1000

    def build_state(self):
        price = self.ws.prices.get("BTCUSDT", 0)
        return [price]*12

    def normalize_weights(self, w):
        w = np.maximum(w, 0)
        floor = 0.05
        w = np.maximum(w, floor)
        return w / np.sum(w)

    def compute_size(self, balance, weight):
        base = balance * weight
        min_size = balance * 0.002
        return max(base * 0.01, min_size)

    async def run(self):
        while True:
            state = self.build_state()
            raw_w = get_action(state)
            weights = self.normalize_weights(raw_w)
            print(f"WEIGHTS: {weights}")
            for i, weight in enumerate(weights):
                size = self.compute_size(self.balance, weight)
                print({"symbol": "BTCUSDT", "size": size, "weight": weight, "balance": self.balance})
                if size > 0:
                    place_order("BTCUSDT", size)
            await asyncio.sleep(2)
