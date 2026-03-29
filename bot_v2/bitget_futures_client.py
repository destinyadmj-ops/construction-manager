"""Bitget Futures REST helper that mirrors the WS payload structure."""
import time
import hmac
import base64
import hashlib
import requests
import json
from urllib.parse import urlencode


class BitgetFuturesClient:
    BASE_URL = "https://api.bitget.com"

    def __init__(self, api_key, api_secret, passphrase):
        self.api_key = api_key
        self.api_secret = api_secret
        self.passphrase = passphrase

    def _timestamp(self):
        return str(int(time.time() * 1000))

    def _sign(self, timestamp, method, request_path, body):
        body_str = json.dumps(body, separators=(',', ':')) if body else ''
        pre_hash = f"{timestamp}{method}{request_path}{body_str}"
        mac = hmac.new(self.api_secret.encode(), pre_hash.encode(), digestmod=hashlib.sha256)
        return base64.b64encode(mac.digest()).decode()

    def _headers(self, method, request_path, body=None):
        timestamp = self._timestamp()
        sign = self._sign(timestamp, method, request_path, body)
        return {
            "ACCESS-KEY": self.api_key,
            "ACCESS-SIGN": sign,
            "ACCESS-TIMESTAMP": timestamp,
            "ACCESS-PASSPHRASE": self.passphrase,
            "Content-Type": "application/json",
        }

    def _sign_get(self, timestamp, request_path_with_query):
        pre_hash = f"{timestamp}GET{request_path_with_query}"
        mac = hmac.new(self.api_secret.encode(), pre_hash.encode(), digestmod=hashlib.sha256)
        return base64.b64encode(mac.digest()).decode()

    def get(self, path, params=None):
        query = urlencode(params or {}, doseq=True)
        request_path = f"{path}?{query}" if query else path
        timestamp = self._timestamp()
        sign = self._sign_get(timestamp, request_path)
        headers = {
            "ACCESS-KEY": self.api_key,
            "ACCESS-SIGN": sign,
            "ACCESS-TIMESTAMP": timestamp,
            "ACCESS-PASSPHRASE": self.passphrase,
            "Content-Type": "application/json",
        }
        url = self.BASE_URL + path
        resp = requests.get(url, headers=headers, params=params or {})
        try:
            return resp.json()
        except Exception:
            return {"error": resp.text}

    def place_order(self, symbol, product_type, margin_mode, margin_coin, side, trade_side, size,
                    order_type="market", price=None, force="gtc", client_oid=None, reduce_only=False):
        path = "/api/v2/mix/order/place-order"
        url = self.BASE_URL + path
        body = {
            "symbol": symbol,
            "productType": product_type,
            "marginMode": margin_mode,
            "marginCoin": margin_coin,
            "side": side,
            "tradeSide": trade_side,
            "orderType": order_type,
            "size": str(size),
            "force": force,
        }
        if price is not None and order_type == "limit":
            body["price"] = str(price)
        if client_oid:
            body["clientOid"] = client_oid
        if reduce_only:
            body["reduceOnly"] = True
        headers = self._headers("POST", path, body)
        resp = requests.post(url, headers=headers, json=body)
        try:
            return resp.json()
        except Exception:
            return {"error": resp.text}

    def get_all_positions(self, product_type="USDT-FUTURES"):
        return self.get(
            path="/api/v2/mix/position/all-position",
            params={"productType": product_type},
        )
