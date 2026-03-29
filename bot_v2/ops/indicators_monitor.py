import os
import time
import logging
from logging.handlers import RotatingFileHandler
from typing import Optional

from bot_v2.datafeed import indicators_engine as ie

# Logger setup: file + stdout, with rotation
_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'logs')
os.makedirs(_LOG_DIR, exist_ok=True)
_LOG_PATH = os.path.join(_LOG_DIR, 'indicators_monitor.log')
logger = logging.getLogger('indicators_monitor')
if not logger.handlers:
    logger.setLevel(logging.INFO)
    fh = RotatingFileHandler(_LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=5, encoding='utf-8')
    fh.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
    logger.addHandler(fh)
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter('%(asctime)s %(levelname)s: %(message)s'))
    logger.addHandler(ch)


def check_indicators_heartbeat(threshold_seconds: int = 120) -> bool:
    try:
        return ie.heartbeat_check()
    except Exception as e:
        logger.error(f"heartbeat_check error: {e}")
        return False


def send_slack_alert(webhook_url: str, text: str) -> bool:
    import time
    import random
    try:
        import requests
    except Exception as e:
        logger.error(f"requests import failed: {e}")
        return False

    max_retries = 3
    base_delay = 0.5
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(webhook_url, json={"text": text}, timeout=8)
            try:
                body_snip = resp.text[:200]
            except Exception:
                body_snip = '<unreadable-body>'
            logger.info(f"send_slack_alert attempt={attempt} status={resp.status_code} url={webhook_url} body_snip={body_snip}")
            # Retry on 429 or 5xx
            if resp.status_code == 429 or (500 <= resp.status_code < 600):
                if attempt < max_retries:
                    delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 0.1)
                    logger.warning(f"send_slack_alert transient status={resp.status_code}, retrying after {delay:.2f}s")
                    time.sleep(delay)
                    continue
                else:
                    logger.error(f"send_slack_alert failed after {attempt} attempts status={resp.status_code}")
                    return False
            # Non-retryable codes: success (2xx) or other 4xx
            return 200 <= resp.status_code < 300
        except requests.exceptions.RequestException as e:
            logger.warning(f"send_slack_alert attempt={attempt} exception: {e}")
            if attempt < max_retries:
                delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 0.1)
                logger.info(f"sleeping {delay:.2f}s before retry")
                time.sleep(delay)
                continue
            else:
                logger.error(f"send_slack_alert failed after {attempt} attempts exception", exc_info=True)
                return False


def check_and_alert(webhook_url: Optional[str] = None, threshold_seconds: int = 120) -> bool:
    ok = check_indicators_heartbeat(threshold_seconds=threshold_seconds)
    if ok:
        logger.info("indicators heartbeat OK")
        return True
    # not ok -> alert
    if webhook_url is None:
        webhook_url = os.getenv('SLACK_WEBHOOK_URL')
    text = f"[監視] indicators heartbeat stale (> {threshold_seconds}s). 確認してください。"
    if webhook_url:
        sent = send_slack_alert(webhook_url, text)
        if sent:
            logger.warning(f"Alert sent to webhook: {webhook_url}")
        else:
            logger.error(f"Alert to {webhook_url} failed after retries; recording fallback alert")
            # Persist fallback alert for operational review
            fallback_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'logs', 'fallback_alerts.log')
            try:
                with open(fallback_path, 'a', encoding='utf-8') as fh:
                    fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} FAILED_ALERT url={webhook_url} text={text}\n")
            except Exception as e:
                logger.error(f"failed to write fallback alert: {e}")
    else:
        logger.warning(text)
    return False


if __name__ == '__main__':
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument('--webhook', help='Slack webhook URL', default=None)
    p.add_argument('--threshold', help='seconds threshold', type=int, default=120)
    args = p.parse_args()
    ok = check_and_alert(webhook_url=args.webhook, threshold_seconds=args.threshold)
    if ok:
        print('OK')
    else:
        print('STALE')
    # exit code for schedulers
    raise SystemExit(0 if ok else 2)
