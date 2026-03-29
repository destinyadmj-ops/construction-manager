import requests
import websocket
import threading
import json
import uuid
import time
import hmac
import hashlib
import base64
from decimal import Decimal, InvalidOperation
from bot_v2.bitget_futures_client import BitgetFuturesClient


class BitgetFuturesWsOrderClient:
    WS_URL = "wss://ws.bitget.com/v2/ws/private"
    SYMBOL_RULES = {
        "BTCUSDT": {
            "instType": "USDT-FUTURES",
            "price_precision": 2,
            "size_precision": 3,
            "min_size": Decimal("0.001"),
            "min_notional": Decimal("5"),
        },
        "ETHUSDT": {
            "instType": "USDT-FUTURES",
            "price_precision": 2,
            "size_precision": 3,
            "min_size": Decimal("0.001"),
            "min_notional": Decimal("3"),
        },
    }

    def __init__(self, api_key, api_secret, passphrase):
        self.api_key = api_key
        self.api_secret = api_secret
        self.passphrase = passphrase
        self.ws = None
        self._response = None
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._login_result = None
        self._rest_client = BitgetFuturesClient(api_key, api_secret, passphrase)
        self._last_order_timestamp = 0.0
        self._min_order_interval = 0.25

    def _on_message(self, ws, message):
        try:
            data = json.loads(message)
            event_type = data.get("op") or data.get("event")
            if event_type == "login":
                with self._lock:
                    self._login_result = data
                    self._event.set()
            elif event_type in ("order", "order.place"):
                with self._lock:
                    self._response = data
                    self._event.set()
            elif event_type == "error":
                print(f"[WS][ERROR] {data}")
                with self._lock:
                    self._response = data
                    self._event.set()
            else:
                print(f"[WS] message: {data}")
        except Exception as e:
            print(f"WebSocket message parse error: {e}")

    def _on_error(self, ws, error):
        print(f"WebSocket error: {error}")

    def _on_close(self, ws, close_status_code, close_msg):
        print(f"WebSocket closed: {close_status_code} {close_msg}")

    def _on_open(self, ws):
        # 認証メッセージ送信
        login_msg = self._build_login_msg()
        ws.send(json.dumps(login_msg))


    def _get_server_timestamp(self):
        try:
            resp = requests.get("https://api.bitget.com/api/v2/public/time", timeout=5)
            data = resp.json()
            ms = int(data['data']['serverTime'])
            print(f"[WS][login] server_timestamp(ms)={ms}")
            return ms
        except Exception as e:
            print(f"[WS][login] サーバー時刻取得失敗: {e}")
            ms = int(time.time() * 1000)
            print(f"[WS][login] fallback local timestamp(ms)={ms}")
            return ms

    def _build_login_msg(self):
        # サーバー時刻（UNIXミリ秒）を取得してtimestampに使う
        timestamp = self._get_server_timestamp()
        pre_sign = f"{timestamp}GET/user/verify"
        sign = hmac.new(
            self.api_secret.encode(),
            pre_sign.encode(),
            hashlib.sha256
        ).digest()
        sign_b64 = base64.b64encode(sign).decode()
        return {
            "op": "login",
            "args": [
                {
                    "apiKey": self.api_key,
                    "passphrase": self.passphrase,
                    "timestamp": str(timestamp),
                    "sign": sign_b64
                }
            ]
        }

    def _get_symbol_rules(self, symbol):
        return self.SYMBOL_RULES.get(symbol, {
            "instType": "USDT-FUTURES",
            "price_precision": 2,
            "size_precision": 3,
            "min_size": Decimal("0.001"),
            "min_notional": Decimal("1"),
        })

    def _validate_order_params(self, symbol, size, order_type, price):
        rules = self._get_symbol_rules(symbol)
        try:
            size_dec = Decimal(str(size))
        except InvalidOperation:
            raise ValueError("size must be numeric")
        if size_dec < rules["min_size"]:
            raise ValueError(f"size below min_size ({rules['min_size']})")
        if -size_dec.as_tuple().exponent > rules["size_precision"]:
            raise ValueError(f"size exceeds precision {rules['size_precision']}")
        if order_type == "limit":
            if price is None:
                raise ValueError("limit order requires price")
            try:
                price_dec = Decimal(str(price))
            except InvalidOperation:
                raise ValueError("price must be numeric")
            if -price_dec.as_tuple().exponent > rules["price_precision"]:
                raise ValueError(f"price exceeds precision {rules['price_precision']}")
            notional = price_dec * size_dec
            if notional < rules["min_notional"]:
                raise ValueError(f"notional {notional} below min {rules['min_notional']}")

    def _enforce_rate_limit(self):
        now = time.time()
        elapsed = now - self._last_order_timestamp
        if elapsed < self._min_order_interval:
            wait = self._min_order_interval - elapsed
            print(f"[WS][rate_limit] sleeping {wait:.3f}s")
            time.sleep(wait)
        self._last_order_timestamp = time.time()

    def _execute_ws(self, order_msg):
        self._response = None
        self._login_result = None
        self._event.clear()
        self.ws = websocket.WebSocketApp(
            self.WS_URL,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
            on_open=self._on_open
        )
        thread = threading.Thread(target=self.ws.run_forever)
        thread.start()
        if not self._event.wait(timeout=10):
            self.ws.close()
            thread.join()
            raise Exception("WebSocket認証タイムアウト")
        if not self._login_result or self._login_result.get("code", 1) != 0:
            self.ws.close()
            thread.join()
            raise Exception(f"WebSocket認証失敗: {self._login_result}")
        self._event.clear()
        self.ws.send(json.dumps(order_msg))
        if not self._event.wait(timeout=10):
            self.ws.close()
            thread.join()
            raise Exception("WebSocket注文応答タイムアウト")
        self.ws.close()
        thread.join()
        return self._response

    def _is_error_payload(self, payload):
        if not payload:
            return True
        code = payload.get("code")
        if code is None and payload.get("event") == "error":
            return True
        if isinstance(code, int) and code != 0:
            return True
        return False

    def _rest_place_order(self, **kwargs):
        print(f"[fallback][rest] payload={kwargs}")
        return self._rest_client.place_order(**kwargs)

    def place_order(
        self,
        symbol,
        marginCoin="USDT",
        productType="USDT-FUTURES",
        marginMode="crossed",
        side="buy",
        tradeSide="open",
        size=0,
        orderType="market",
        price=None,
        force="gtc",
        reduceOnly=False,
        clientOid=None,
    ):
        if clientOid is None:
            clientOid = str(uuid.uuid4())
        symbol_info = self.SYMBOL_RULES.get(symbol, {})
        inst_type = symbol_info.get("instType", productType)
        self._validate_order_params(symbol, size, orderType, price)
        self._enforce_rate_limit()
        params = {
            "marginCoin": marginCoin,
            "marginMode": marginMode,
            "side": side,
            "tradeSide": tradeSide,
            "orderType": orderType,
            "size": str(size),
            "force": force,
            "clientOid": clientOid,
        }
        if price is not None and orderType == "limit":
            params["price"] = str(price)
        if reduceOnly:
            params["reduceOnly"] = True

        order_msg = {
            "op": "trade",
            "args": [
                {
                    "id": str(uuid.uuid4()),
                    "instType": inst_type,
                    "instId": symbol,
                    "channel": "place-order",
                    "params": params,
                }
            ],
        }
        print(f"[WS][order_payload] {json.dumps(order_msg)}")

        try:
            ws_resp = self._execute_ws(order_msg)
            if self._is_error_payload(ws_resp):
                raise ValueError(f"WS order error {ws_resp}")
            return {"transport": "ws", "response": ws_resp}
        except Exception as ws_exc:
            rest_resp = self._rest_place_order(
                symbol=symbol,
                product_type=productType,
                margin_mode=marginMode,
                margin_coin=marginCoin,
                side=side,
                trade_side=tradeSide,
                size=size,
                order_type=orderType,
                price=price,
                force=force,
                client_oid=clientOid,
                reduce_only=reduceOnly,
            )
            if rest_resp:
                return {
                    "transport": "rest",
                    "response": rest_resp,
                    "ws_error": str(ws_exc),
                }
            raise

