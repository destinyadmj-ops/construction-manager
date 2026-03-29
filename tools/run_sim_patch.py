import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate
import os

# Patch config thresholds to a dramatic set for testing
cfg.DYNAMIC_SL_THRESHOLDS = [(0.8, 0.01), (0.5, 0.02), (0.0, 0.50)]
print('Patched DYNAMIC_SL_THRESHOLDS =', cfg.DYNAMIC_SL_THRESHOLDS)

csv_path = os.path.join('bot_v2','tools','data','btc_sample.csv')
simulate(csv_path, entry_index=0, size=0.01, side='buy', strategy='alert_d', atr_default=10.0)
