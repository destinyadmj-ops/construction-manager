from bot_v2.execution.position_exit_engine import PositionExitEngine
from bot_v2.position.position_manager import Position
import bot_v2.config as cfg

cfg.DYNAMIC_SL_THRESHOLDS = [(0.8, 0.0001),(0.5,0.0001),(0.0,0.0001)]
pe = PositionExitEngine()
pos = Position(symbol='BTC', strategy='alert_d', side='buy', entry_price=68025.36, size=0.01)
print('sl thresholds', cfg.DYNAMIC_SL_THRESHOLDS)
for test_price in [68025.36, 68018.35, 68006.0, 67975.0]:
    detail = pe.evaluate_detail(pos, test_price)
    print('price', test_price, '->', detail)
