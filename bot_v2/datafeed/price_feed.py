from __future__ import annotations

import json
import threading
import time

import websocket


def _normalize_symbol(symbol: str) -> str:
    return str(symbol or '').strip().upper().replace('_UMCBL', '')


class PriceFeed:
    def __init__(self, symbols: list[str] | None = None, url: str = 'wss://ws.bitget.com/mix/v2/stream'):
        requested = symbols or ['BTCUSDT']
        self.symbols = [_normalize_symbol(symbol) for symbol in requested if str(symbol or '').strip()]
        self.url = url
        self.prices: dict[str, float] = {}
        self.ws = None
        self.thread = None
        self._started = False
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._reconnect_delay = 2.0

    def _subscribe_payload(self) -> dict:
        return {
            'op': 'subscribe',
            'args': [
                {'instType': 'UMCBL', 'channel': 'ticker', 'instId': f'{symbol}_UMCBL'}
                for symbol in self.symbols
            ],
        }

    def _on_message(self, ws, message):
        try:
            payload = json.loads(message)
        except Exception:
            return
        for item in payload.get('data') or []:
            symbol = _normalize_symbol(item.get('instId') or item.get('symbol') or '')
            if not symbol:
                continue
            try:
                price = float(item.get('last'))
            except Exception:
                continue
            with self._lock:
                self.prices[symbol] = price

    def _on_open(self, ws):
        self._reconnect_delay = 2.0
        ws.send(json.dumps(self._subscribe_payload()))

    def _on_error(self, ws, error):
        pass

    def _on_close(self, ws, close_status_code, close_msg):
        return

    def _run_forever_loop(self):
        while not self._stop_event.is_set():
            try:
                self.ws = websocket.WebSocketApp(
                    self.url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                self.ws.run_forever(ping_interval=20, ping_timeout=10, reconnect=0)
            except Exception:
                pass

            if self._stop_event.is_set():
                break

            time.sleep(self._reconnect_delay)
            self._reconnect_delay = min(self._reconnect_delay * 1.5, 15.0)

    def start(self):
        if self._started:
            return
        self._started = True
        self._stop_event.clear()
        self.thread = threading.Thread(target=self._run_forever_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self._stop_event.set()
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass
        self._started = False

    def get_price(self, symbol: str):
        normalized = _normalize_symbol(symbol)
        with self._lock:
            return self.prices.get(normalized)

    def get_prices(self) -> dict[str, float]:
        with self._lock:
            return dict(self.prices)

    def wait_for_price(self, symbol: str, timeout: float = 5.0):
        normalized = _normalize_symbol(symbol)
        deadline = time.time() + max(0.0, float(timeout))
        while time.time() <= deadline:
            price = self.get_price(normalized)
            if price is not None:
                return price
            time.sleep(0.1)
        return None