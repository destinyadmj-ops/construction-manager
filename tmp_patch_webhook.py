"""
webhook_bot_v2.py へのパッチスクリプト
修正内容:
  1. ACCOUNT_BALANCE import → get_balance() を追加
  2. position_sizer.calculate() の引数を get_balance() に変更
  3. portfolio_engine.allow_trade([]) → 実ポジション数を渡す
  4. /monitor エンドポイントを末尾に追加（trailing stop トリガー）
"""
import re

path = "/home/linuxuser/webhook_bot_v2.py"

with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# --- 1. import に get_balance を追加 ---
old_import = "from bot_v2.config import SYMBOLS, DEFAULT_SYMBOL, ACCOUNT_BALANCE"
new_import = (
    "from bot_v2.config import SYMBOLS, DEFAULT_SYMBOL, ACCOUNT_BALANCE\n"
    "from bot_v2.risk.account_balance import get_balance as _get_live_balance"
)
if old_import in src:
    src = src.replace(old_import, new_import, 1)
    print("[1] import patch OK")
else:
    print("[1] WARN: import line not found, skipped")

# --- 2. position_sizer.calculate(ACCOUNT_BALANCE, candles) → get_balance() ---
old_size = "float(position_sizer.calculate(ACCOUNT_BALANCE, candles))"
new_size = "float(position_sizer.calculate(_get_live_balance(), candles))"
if old_size in src:
    src = src.replace(old_size, new_size, 1)
    print("[2] position_sizer balance patch OK")
else:
    print("[2] WARN: position_sizer line not found, skipped")

# --- 3. portfolio_engine.allow_trade([]) → 実ポジション数を渡す ---
old_portfolio = "if not portfolio_engine.allow_trade([]):"
new_portfolio = (
    "# 実ポジション数を渡してポートフォリオリスクを正しくチェック\n"
    "        _live_positions = []\n"
    "        try:\n"
    "            _pos_resp = exchange_client.request('GET', '/api/v2/mix/position/all-position', {'productType': 'USDT-FUTURES'})\n"
    "            _live_positions = [p for p in (_pos_resp.get('data') or []) if float(p.get('total', 0) or 0) > 0]\n"
    "        except Exception:\n"
    "            pass\n"
    "        if not portfolio_engine.allow_trade(_live_positions):"
)
if old_portfolio in src:
    src = src.replace(old_portfolio, new_portfolio, 1)
    print("[3] portfolio allow_trade patch OK")
else:
    print("[3] WARN: portfolio line not found, skipped")

# --- 4. /monitor エンドポイントを追加（if __name__ の直前）---
monitor_endpoint = '''

@app.post('/monitor')
def monitor():
    """
    trailing stop のトリガー用エンドポイント
    phase45_observe.timer から 5 分毎に呼ばれる
    """
    from bot_v2.risk.trailing_stop import update_trailing_dynamic
    symbols_to_check = SYMBOLS

    updated = []
    errors = []

    for sym in symbols_to_check:
        try:
            resp = exchange_client.request(
                'GET', '/api/v2/mix/position/all-position',
                {'productType': 'USDT-FUTURES'}
            )
            positions = resp.get('data') or []
            for pos in positions:
                if pos.get('symbol') != sym:
                    continue
                total = float(pos.get('total', 0) or 0)
                if total <= 0:
                    continue
                update_trailing_dynamic(sym, pos)
                updated.append({'symbol': sym, 'side': pos.get('holdSide'), 'size': total})
        except Exception as exc:
            errors.append({'symbol': sym, 'error': str(exc)})

    return jsonify({'status': 'ok', 'updated': updated, 'errors': errors}), 200

'''

main_marker = "\nif __name__ == '__main__':"
if main_marker in src and '/monitor' not in src:
    src = src.replace(main_marker, monitor_endpoint + main_marker, 1)
    print("[4] /monitor endpoint added OK")
elif '/monitor' in src:
    print("[4] /monitor already exists, skipped")
else:
    print("[4] WARN: main marker not found")

with open(path, "w", encoding="utf-8") as f:
    f.write(src)

print("=== PATCH COMPLETE ===")
