import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate
import os

# use default thresholds but ensure PositionExitEngine is used
cfg.DYNAMIC_SL_THRESHOLDS = [(0.8, 0.09), (0.5, 0.12), (0.0, 0.18)]
print('Using DYNAMIC_SL_THRESHOLDS =', cfg.DYNAMIC_SL_THRESHOLDS)

csv_path = os.path.join('bot_v2','tools','data','synthetic.csv')
simulate(csv_path, entry_index=0, size=1.0, side='buy', strategy='alert_d', atr_default=1.0)
