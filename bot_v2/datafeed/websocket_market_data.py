"""
Websocket Market Data
- 完全な板・約定・価格データのリアルタイム取得
- サンプル: Bitget/Bybit/Binance等のWebsocket接続
"""
import websocket
import threading
import json

class WebsocketMarketData:
    def __init__(self, url, subscribe_msg, reconnect=True, ping_interval=30):
        self.url = url
        self.subscribe_msg = subscribe_msg
        self.ws = None
        self.data = []
        self.thread = None
        self.reconnect = reconnect
        self.ping_interval = ping_interval
        self._stop_event = threading.Event()

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            # pong応答は無視
            if data == "pong":
                return
            self.data.append(data)
        except Exception as e:
            print(f"WebSocket message parse error: {e}")

    def on_error(self, ws, error):
        print(f"WebSocket error: {error}")

    def on_close(self, ws, close_status_code, close_msg):
        print(f"WebSocket closed: {close_status_code} {close_msg}")
        if self.reconnect and not self._stop_event.is_set():
            print("WebSocket reconnecting...")
            self._start_ws()

    def on_open(self, ws):
        # v2仕様: subscribe_msgがdict型であることを想定
        ws.send(json.dumps(self.subscribe_msg))

    def _start_ws(self):
        self.ws = websocket.WebSocketApp(
            self.url,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
            on_open=self.on_open
        )
        self.thread = threading.Thread(target=self._run_ws)
        self.thread.start()

    def _run_ws(self):
        # ping送信スレッド
        def ping_loop():
            while not self._stop_event.is_set():
                try:
                    if self.ws and self.ws.sock and self.ws.sock.connected:
                        self.ws.send("ping")
                    else:
                        break
                except Exception as e:
                    print(f"WebSocket ping error: {e}")
                self._stop_event.wait(self.ping_interval)

        ping_thread = threading.Thread(target=ping_loop)
        ping_thread.daemon = True
        ping_thread.start()
        try:
            self.ws.run_forever()
        except Exception as e:
            print(f"WebSocket run_forever error: {e}")
        finally:
            self._stop_event.set()
            ping_thread.join()

    def start(self):
        self._stop_event.clear()
        self._start_ws()

    def stop(self):
        self._stop_event.set()
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
        if self.thread:
            self.thread.join()
