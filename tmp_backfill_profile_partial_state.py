from __future__ import annotations

import json
from pathlib import Path


REGISTRY_PATH = Path('/home/linuxuser/bot_v2/data/positions.json')


def main():
    if not REGISTRY_PATH.exists():
        print(json.dumps({'status': 'missing', 'path': str(REGISTRY_PATH)}, ensure_ascii=False))
        return

    payload = json.loads(REGISTRY_PATH.read_text(encoding='utf-8'))
    if not isinstance(payload, dict):
        print(json.dumps({'status': 'invalid_format', 'type': str(type(payload))}, ensure_ascii=False))
        return

    positions = payload.get('positions')
    if not isinstance(positions, list):
        print(json.dumps({'status': 'invalid_positions'}, ensure_ascii=False))
        return

    patched = 0
    for row in positions:
        if not isinstance(row, dict):
            continue
        if str(row.get('status') or 'open') != 'open':
            continue
        context = dict(row.get('entry_context') or {})
        changed = False
        if context.get('initial_size') in (None, '', 0):
            context['initial_size'] = float(row.get('size') or 0.0)
            changed = True
        partial_taken = context.get('partial_taken')
        if not isinstance(partial_taken, list) or len(partial_taken) != 3:
            context['partial_taken'] = [False, False, False]
            changed = True
        if changed:
            row['entry_context'] = context
            patched += 1

    if patched > 0:
        REGISTRY_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

    print(json.dumps({'status': 'ok', 'patched': patched}, ensure_ascii=False))


if __name__ == '__main__':
    main()