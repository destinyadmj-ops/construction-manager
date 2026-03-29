
from bot_v2.bitget_futures_ws_order_client import BitgetFuturesWsOrderClient
import os
from dotenv import load_dotenv

load_dotenv()


def print_section(title):
    print("\n" + "=" * 10 + f" {title} " + "=" * 10)


if __name__ == "__main__":
    api_key = os.getenv("EXCHANGE_API_KEY", "")
    api_secret = os.getenv("EXCHANGE_API_SECRET", "")
    passphrase = os.getenv("EXCHANGE_PASSPHRASE", "")
    print_section("Credentials")
    print(f"API_KEY={api_key}")
    print(f"API_SECRET={api_secret}")
    print(f"PASSPHRASE={passphrase}")

    ws_client = BitgetFuturesWsOrderClient(api_key, api_secret, passphrase)
    print_section("WS Order (Direct)")
    resp = ws_client.place_order(
        symbol="BTCUSDT",
        marginCoin="USDT",
        side="buy",
        tradeSide="open",
        size=0.001,
        orderType="market",
    )
    print(resp)

    print_section("WS Order (Forced REST Fallback)")
    ws_client.WS_URL = "wss://unreachable.bitget.com"
    fallback = ws_client.place_order(
        symbol="BTCUSDT",
        marginCoin="USDT",
        side="buy",
        tradeSide="open",
        size=0.001,
        orderType="market",
    )
    print(fallback)
