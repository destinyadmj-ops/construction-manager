import asyncio
import websockets
import json

class BitgetWS:
    def __init__(self):
        self.prices = {}

    async def connect(self):
        url = "wss://ws.bitget.com/v2/ws/public"
        while True:
            try:
                async with websockets.connect(url, ping_interval=20) as ws:
                    await ws.send(json.dumps({
                        "op": "subscribe",
                        "args": [{
                            "instType": "mc",
                            "channel": "ticker",
                            "instId": "BTCUSDT"
                        }]
                    }))
                    while True:
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=30)
                            data = json.loads(msg)
                            if "data" in data:
                                price = float(data["data"][0]["last"])
                                self.prices["BTCUSDT"] = price
                        except asyncio.TimeoutError:
                            print("[WS] timeout, sending ping...")
                            await ws.ping()
            except Exception as e:
                print("[WS error]", e)
                await asyncio.sleep(3)
