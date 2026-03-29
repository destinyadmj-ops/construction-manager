from tools.pe_trace import trace

# trace real high-vol file at entry index 100 for 200 steps
trace('bot_v2/tools/data/btc_highvol.csv', entry_index=100, steps=200, side='buy')
