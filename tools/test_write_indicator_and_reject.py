import os
import traceback
from bot_v2.datafeed import indicators_engine as ie
from bot_v2.datafeed.rejected_signals_db import record_rejected_signal, ensure_rejected_signals_table

try:
	os.makedirs(os.path.dirname(ie.INDICATOR_PATH), exist_ok=True)
	ind = ie.default_indicator_values()
	ind.update({'symbol':'BTCUSDT', 'ATR':0.012, 'RSI':55.2, 'volatility':0.0018, 'ema_fast':12345, 'ema_slow':12300, 'timeframe':'1m'})
	ie.update_indicators(ind)
	print('wrote indicators')

	ensure_rejected_signals_table()
	record_rejected_signal(symbol='BTCUSDT', alert_name='alert_test', side='buy', score=0.3, threshold=0.6, reason='test_reject', extra={'note':'smoke'})
	print('wrote rejected signal')
except Exception:
	traceback.print_exc()
	raise
