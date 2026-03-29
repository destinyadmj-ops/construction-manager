from execution.bitget_client import BitgetClient


def main():
    client = BitgetClient()
    account = client.request("GET", "/api/v2/mix/account/accounts", {"productType": "USDT-FUTURES"})
    print({"account": account})


if __name__ == "__main__":
    main()