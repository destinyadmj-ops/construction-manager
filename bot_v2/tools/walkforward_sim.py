"""
walkforward_sim.py

シンプルなウォークフォワード検証ツール。
- 入力: CSV (timestamp, price[, atr])
- 指定インデックスでエントリーし、PositionExitEngine を使って逐次判定
- 決済発生時に `bot_v2.datafeed.trades_db.record_trade` に履歴を保存

使い方例:
python -m bot_v2.tools.walkforward_sim --csv data/btc_sample.csv --entry-index 0 --size 0.01
"""
import argparse
import csv
import os
import json
from typing import Optional, List, Dict

import math

try:
    from bot_v2.execution.position_exit_engine import PositionExitEngine
except Exception:
    PositionExitEngine = None
from bot_v2.position.position_manager import Position
from bot_v2.datafeed.trades_db import record_trade


class SimpleExitEngine:
    """Importできない場合の簡易代替エンジン（ウォークフォワード用）
    - 部分利確: +1% と +2%
    - ハードストップ: -20%
    - 動的SL: entry時 -20%、ROI>=50% -> -15%、ROI>=80% -> -10%
    """
    def evaluate_detail(self, pos, price: float, state: dict | None = None) -> dict:
        entry = getattr(pos, 'entry_price', 0.0)
        size = getattr(pos, 'size', 0.0)
        if entry <= 0 or size <= 0:
            return {'actions': [], 'reason': 'invalid', 'state': state}
        side = str(getattr(pos, 'side', 'buy') or 'buy').lower()
        if side in ('sell', 'short'):
            roi = (entry - price) / entry
        else:
            roi = (price - entry) / entry

        if state is None:
            state = {'tp1_done': False, 'tp2_done': False, 'dynamic_sl': None}

        actions = []
        reason_parts = []

        # partials
        if not state.get('tp1_done', False) and roi >= 0.01:
            actions.append(('partial', 0.3))
            reason_parts.append('partial_tp1')
            state['tp1_done'] = True
        if not state.get('tp2_done', False) and roi >= 0.02:
            actions.append(('partial', 0.3))
            reason_parts.append('partial_tp2')
            state['tp2_done'] = True

        # hard stop
        if roi <= -0.20:
            actions = [('close', 1.0)]
            reason_parts = ['hard_stop']

        # dynamic SL
        if roi >= 0.8:
            dyn = 0.10
        elif roi >= 0.5:
            dyn = 0.15
        else:
            dyn = 0.20
        state['dynamic_sl'] = dyn
        if side in ('sell', 'short'):
            sl_price = entry * (1.0 + dyn)
            if price >= sl_price:
                actions = [('close', 1.0)]
                reason_parts.append('dynamic_sl')
        else:
            sl_price = entry * (1.0 - dyn)
            if price <= sl_price:
                actions = [('close', 1.0)]
                reason_parts.append('dynamic_sl')

        return {'actions': actions, 'reason': ','.join(reason_parts) if reason_parts else 'hold', 'state': state}


if PositionExitEngine is None:
    EngineClass = SimpleExitEngine
else:
    EngineClass = PositionExitEngine


def load_csv(path: str):
    rows = []
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                price = float(r.get('price') or r.get('close') or r.get('mid') or 0.0)
            except Exception:
                price = 0.0
            try:
                atr = float(r.get('atr') or 0.0)
            except Exception:
                atr = 0.0
            rows.append({'timestamp': r.get('timestamp'), 'price': price, 'atr': atr})
    return rows


def simulate(csv_path: str, entry_index: int, size: float, side: str, strategy: str, atr_default: float = 10.0):
    series = load_csv(csv_path)
    if not series:
        print('CSV が空です')
        return

    if entry_index < 0 or entry_index >= len(series):
        print('entry_index 範囲外')
        return

    entry_row = series[entry_index]
    entry_price = entry_row['price']
    pos = Position(
        symbol=os.path.basename(csv_path).split('.')[0].upper(),
        strategy=strategy,
        side=side,
        entry_price=entry_price,
        size=size,
    )
    # 初期ATRはローカル変数で扱う（Position は slots=True のため属性追加不可）
    initial_atr = series[entry_index].get('atr') or atr_default

    # pick the engine class at runtime without reassigning module-level name
    engine_cls = globals().get('EngineClass')
    try:
        from bot_v2.execution.position_exit_engine import PositionExitEngine as _PE
        engine_cls = _PE
    except Exception:
        if engine_cls is None:
            engine_cls = SimpleExitEngine
    engine = engine_cls()
    print(f'Using exit engine: {engine.__class__.__name__}')

    open_idx = entry_index
    trades: List[Dict] = []

    # position state for fallback engine
    pos_state: dict = {'tp1_done': False, 'tp2_done': False, 'dynamic_sl': None}

    for idx in range(entry_index + 1, len(series)):
        row = series[idx]
        price = row['price']
        atr = row.get('atr') or atr_default

        if isinstance(engine, SimpleExitEngine):
            detail = engine.evaluate_detail(pos, price, state=pos_state)
            pos_state = detail.get('state', pos_state)
        else:
            detail = engine.evaluate_detail(pos, price)
        actions = detail.get('actions', [])

        for action, ratio in actions:
            if action == 'partial':
                close_size = max(0.0, min(pos.size, pos.size * float(ratio)))
                realized = ((price - pos.entry_price) if pos.side in ('buy','long') else (pos.entry_price - price)) * close_size
                record_trade(symbol=pos.symbol, side=pos.side, entry_price=pos.entry_price, exit_price=price, size=close_size, pnl=realized, exit_reason='partial')
                trades.append({'exit_idx': idx, 'price': price, 'pnl': realized, 'reason': 'partial'})
                pos.size = max(0.0, pos.size - close_size)
            elif action == 'close':
                close_size = pos.size
                realized = ((price - pos.entry_price) if pos.side in ('buy','long') else (pos.entry_price - price)) * close_size
                record_trade(symbol=pos.symbol, side=pos.side, entry_price=pos.entry_price, exit_price=price, size=close_size, pnl=realized, exit_reason=detail.get('reason','close'))
                trades.append({'exit_idx': idx, 'price': price, 'pnl': realized, 'reason': detail.get('reason','close')})
                pos.size = 0.0
                pos.closed = True
                break

        if getattr(pos, 'closed', False) or pos.size <= 0:
            break

    # サマリ表示とレポート生成
    total_pnl = sum([t['pnl'] for t in trades])
    num_trades = len(trades)
    wins = sum(1 for t in trades if t['pnl'] > 0)
    losses = num_trades - wins
    win_rate = (wins / num_trades) if num_trades > 0 else 0.0
    avg_pnl = (total_pnl / num_trades) if num_trades > 0 else 0.0
    avg_win = (sum(t['pnl'] for t in trades if t['pnl'] > 0) / wins) if wins > 0 else 0.0
    avg_loss = (sum(t['pnl'] for t in trades if t['pnl'] <= 0) / losses) if losses > 0 else 0.0

    # エクイティ曲線から最大ドローダウンを計算
    cumulative = []
    cur = 0.0
    for t in trades:
        cur += t['pnl']
        cumulative.append(cur)
    peak = 0.0
    max_dd = 0.0
    max_dd_pct = 0.0
    for v in cumulative:
        if v > peak:
            peak = v
        dd = peak - v
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = (dd / peak) if peak > 0 else 0.0

    report = {
        'csv': csv_path,
        'entry_index': entry_index,
        'entry_price': entry_price,
        'num_trades': num_trades,
        'total_pnl': total_pnl,
        'win_rate': win_rate,
        'wins': wins,
        'losses': losses,
        'avg_pnl': avg_pnl,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'max_drawdown': max_dd,
        'max_drawdown_pct': max_dd_pct,
        'max_consecutive_wins': 0,
        'max_consecutive_losses': 0,
        'trades': trades,
    }

    # ディレクトリ作成
    reports_dir = os.path.join(os.path.dirname(__file__), 'reports')
    os.makedirs(reports_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(csv_path))[0]
    report_path = os.path.join(reports_dir, f'{base}_wf_report.json')
    with open(report_path, 'w', encoding='utf-8') as rf:
        json.dump(report, rf, ensure_ascii=False, indent=2)

    print('ウォークフォワード結果')
    print(f'エントリ価格: {entry_price}  エントリインデックス: {entry_index}')
    print(f'トレード数: {num_trades}  合計PnL: {total_pnl}  勝率: {win_rate:.2%}  最大ドローダウン: {max_dd} ({max_dd_pct:.2%})')
    print(f'レポート出力: {report_path}')

    # --- 追加メトリクス: 連勝/連敗 と 累積CSV出力 ---
    consec_win = 0
    consec_loss = 0
    max_consec_win = 0
    max_consec_loss = 0
    cum = 0.0
    cum_rows = []
    for t in trades:
        pnl = t['pnl']
        cum += pnl
        cum_rows.append({'exit_idx': t.get('exit_idx'), 'cum_equity': cum})
        if pnl > 0:
            consec_win += 1
            consec_loss = 0
        else:
            consec_loss += 1
            consec_win = 0
        max_consec_win = max(max_consec_win, consec_win)
        max_consec_loss = max(max_consec_loss, consec_loss)

    # update report with streaks
    report['max_consecutive_wins'] = max_consec_win
    report['max_consecutive_losses'] = max_consec_loss

    # write cumulative CSV for quick plotting
    cum_csv_path = os.path.join(reports_dir, f'{base}_cum_equity.csv')
    try:
        with open(cum_csv_path, 'w', encoding='utf-8') as cf:
            cf.write('exit_idx,cum_equity\n')
            for r in cum_rows:
                cf.write(f"{r.get('exit_idx')},{r.get('cum_equity')}\n")
    except Exception:
        pass

    # rewrite report with streaks
    with open(report_path, 'w', encoding='utf-8') as rf:
        json.dump(report, rf, ensure_ascii=False, indent=2)

    print(f'累積CSV出力: {cum_csv_path}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', required=True)
    parser.add_argument('--entry-index', type=int, default=0)
    parser.add_argument('--size', type=float, default=0.01)
    parser.add_argument('--side', choices=['buy','sell','long','short'], default='buy')
    parser.add_argument('--strategy', default='alert_d')
    parser.add_argument('--atr-default', type=float, default=10.0)
    args = parser.parse_args()

    simulate(args.csv, args.entry_index, args.size, args.side, args.strategy, args.atr_default)


if __name__ == '__main__':
    main()
