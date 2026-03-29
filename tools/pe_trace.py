from pathlib import Path
import csv
import bot_v2.config as cfg
from bot_v2.execution.position_exit_engine import PositionExitEngine
from bot_v2.position.position_manager import Position

def load_prices(path):
    rows = []
    with open(path, newline='') as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(float(row['price']))
    return rows

def trace(csv_path, entry_index=0, steps=60, side='buy'):
    prices = load_prices(csv_path)
    pe = PositionExitEngine()
    entry_price = prices[entry_index]
    pos = Position(symbol='BTC', strategy='alert_d', side=side, entry_price=entry_price, size=0.01)
    out = []
    out.append(f'Entry idx {entry_index} price {entry_price}')
    for i in range(entry_index, min(len(prices), entry_index+steps)):
        p = prices[i]
        d = pe.evaluate_detail(pos, p)
        out.append(f'idx {i} price {p:.8f} -> {d}')
    text = '\n'.join(out)
    print(text)
    Path('tools/pe_trace_out.txt').write_text(text, encoding='utf-8')

if __name__ == '__main__':
    csv_path = Path('bot_v2') / 'tools' / 'data' / 'btc_sample.csv'
    trace(str(csv_path), entry_index=0, steps=120, side='buy')
