import json
import sys


sys.path.insert(0, "/home/linuxuser")

import webhook_bot_v2 as appmod


def fake_execute_trade(symbol, signal, size):
    return {
        "stubbed": True,
        "kind": "open",
        "symbol": symbol,
        "signal": signal,
        "size": size,
    }


def fake_close_position(symbol, side, size):
    return {
        "stubbed": True,
        "kind": "close",
        "symbol": symbol,
        "side": side,
        "size": size,
    }


appmod.execute_trade = fake_execute_trade
appmod.close_position = fake_close_position


def run_case(payload):
    client = appmod.app.test_client()
    response = client.post("/webhook", json=payload)
    body = response.get_json(silent=True)
    print(json.dumps({"payload": payload, "status_code": response.status_code, "body": body}, ensure_ascii=False))


if __name__ == "__main__":
    run_case({"symbol": "ABCXYZ", "action": "buy", "size": 0.001})
    run_case({"symbol": "BTCUSDT", "action": "buy", "size": 0.00123})