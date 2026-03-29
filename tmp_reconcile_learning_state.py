import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv('/home/linuxuser/.bitget_env')

from bot_v2.bitget_futures_client import BitgetFuturesClient

state_path = Path('/home/linuxuser/bot_v2/data/alert_learning_state.json')
if not state_path.exists():
    print('state_missing')
    raise SystemExit(0)

api_key = os.getenv('EXCHANGE_API_KEY', '')
api_secret = os.getenv('EXCHANGE_API_SECRET', '')
api_passphrase = os.getenv('EXCHANGE_PASSPHRASE', '')

client = BitgetFuturesClient(api_key, api_secret, api_passphrase)
resp = client.get_all_positions(product_type='USDT-FUTURES')
open_symbols = {
    str(p.get('symbol'))
    for p in (resp.get('data') or [])
    if float(p.get('total', 0) or 0) > 0
}

state = json.loads(state_path.read_text(encoding='utf-8'))
trades = state.get('trades', [])
closed_count = 0
for trade in trades:
    if trade.get('result') != 'open':
        continue
    symbol = str(trade.get('symbol') or '')
    if symbol in open_symbols:
        continue
    trade['result'] = 'loss'
    trade['win'] = False
    trade['roi'] = float(trade.get('roi') or 0.0)
    trade['rr'] = float(trade.get('rr') or 0.0)
    trade['closed_at'] = trade.get('closed_at') or 'reconciled'
    closed_count += 1

alerts = state.get('alerts', {})
for alert_name, metrics in alerts.items():
    related = [t for t in trades if t.get('alert') == alert_name and t.get('result') in ('win', 'loss')]
    closed = len(related)
    wins = sum(1 for t in related if t.get('result') == 'win')
    roi_total = sum(float(t.get('roi') or 0.0) for t in related)
    rr_total = sum(float(t.get('rr') or 0.0) for t in related)
    metrics['closed'] = closed
    metrics['wins'] = wins
    metrics['roi_total'] = roi_total
    metrics['rr_total'] = rr_total

state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
print('closed_reconciled', closed_count)
print('open_symbols', sorted(open_symbols))
print('total_trades', len(trades))
