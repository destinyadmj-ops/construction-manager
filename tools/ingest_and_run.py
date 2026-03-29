import argparse
import ast
import csv
import os
import bot_v2.config as cfg
from bot_v2.tools.walkforward_sim import simulate


def load_top_thresholds(path='bot_v2/tools/reports/grid_top5_summary.csv'):
    if not os.path.isfile(path):
        return None
    with open(path,'r',encoding='utf-8') as f:
        r=csv.DictReader(f)
        first=next(r)
        return ast.literal_eval(first.get('thresholds_json') or '[]')


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--csv', required=True)
    p.add_argument('--entries', default='0,100')
    p.add_argument('--size', type=float, default=0.01)
    p.add_argument('--side', default='buy')
    p.add_argument('--strategy', default='alert_d')
    args=p.parse_args()

    thresholds = load_top_thresholds()
    if thresholds:
        cfg.DYNAMIC_SL_THRESHOLDS = [(float(t[0]), float(t[1])) for t in thresholds]
        print('Patched DYNAMIC_SL_THRESHOLDS from top5')

    entries=[int(x) for x in str(args.entries).split(',') if x.strip()!='']
    for e in entries:
        print('Running simulate for entry',e)
        simulate(args.csv, e, args.size, args.side, args.strategy)

if __name__=='__main__':
    main()
