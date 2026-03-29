import importlib,traceback
try:
    m=importlib.import_module('bot_v2.execution.position_exit_engine')
    print('import ok:', m.PositionExitEngine.__name__)
except Exception:
    traceback.print_exc()
