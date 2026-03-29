#!/usr/bin/env python3
"""Audit `logs/indicators_monitor.log` for failures, 429, 5xx and record reports.

Usage: python tools/audit_indicators_monitor_logs.py [--webhook <url>]
This script keeps a small state file `logs/audit_state.json` to process only new lines.
"""
import os
import re
import json
import csv
import argparse
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
LOG_DIR = os.path.join(ROOT, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)
LOG_PATH = os.path.join(LOG_DIR, 'indicators_monitor.log')
STATE_PATH = os.path.join(LOG_DIR, 'audit_state.json')
REPORTS_DIR = os.path.join(LOG_DIR, 'audit_reports')
os.makedirs(REPORTS_DIR, exist_ok=True)

PAT_STATUS = re.compile(r'status=(\d{3})')

def load_state():
    if not os.path.exists(STATE_PATH):
        return {'pos': 0}
    try:
        with open(STATE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'pos': 0}

def save_state(state):
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f)

def send_slack_summary(webhook, text):
    try:
        import requests
    except Exception:
        return False
    try:
        resp = requests.post(webhook, json={'text': text}, timeout=8)
        return resp.status_code >= 200 and resp.status_code < 300
    except Exception:
        return False

def main(webhook=None):
    state = load_state()
    pos = state.get('pos', 0)
    if not os.path.exists(LOG_PATH):
        print('no log file yet')
        return 0
    anomalies = []
    with open(LOG_PATH, 'r', encoding='utf-8', errors='replace') as f:
        f.seek(pos)
        for line in f:
            l = line.strip()
            if not l:
                continue
            m = PAT_STATUS.search(l)
            if m:
                code = int(m.group(1))
                if code == 429 or (500 <= code < 600):
                    anomalies.append((datetime.utcnow().isoformat(), 'http', code, l))
                    continue
            if 'send_slack_alert failed' in l or 'exception' in l.lower() or 'failed_after' in l.lower() or 'FAILED_ALERT' in l:
                anomalies.append((datetime.utcnow().isoformat(), 'error', '', l))
    # update state
    state['pos'] = os.path.getsize(LOG_PATH)
    save_state(state)

    if anomalies:
        # write report
        today = datetime.utcnow().strftime('%Y-%m-%d')
        report_path = os.path.join(REPORTS_DIR, f'report_{today}.csv')
        new_file = not os.path.exists(report_path)
        with open(report_path, 'a', newline='', encoding='utf-8') as csvf:
            writer = csv.writer(csvf)
            if new_file:
                writer.writerow(['reported_at_utc','type','code','line'])
            for a in anomalies:
                writer.writerow(a)
        # send summary to webhook if provided
        summary = f"IndicatorsMonitor anomalies detected: {len(anomalies)}\nSample:\n" + '\n'.join([x[3] for x in anomalies[:5]])
        if webhook:
            ok = send_slack_summary(webhook, summary)
            print('sent webhook?', ok)
        print('anomalies:', len(anomalies))
    else:
        print('no anomalies')
    return 0

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--webhook', default=None)
    args = p.parse_args()
    raise SystemExit(main(webhook=args.webhook))
