"""軽量テストランナー: tests フォルダ内の test_*.py をインポートし、test_ 関数を実行します
実行: python tools/run_tests.py
"""
import sys, os, importlib.util, traceback

TEST_DIR = os.path.join(os.path.dirname(__file__), '..', 'tests')

sys.path.insert(0, os.path.abspath('.'))

results = []

for fname in sorted(os.listdir(TEST_DIR)):
    if not fname.startswith('test_') or not fname.endswith('.py'):
        continue
    module_name = fname[:-3]
    path = os.path.join(TEST_DIR, fname)
    spec = importlib.util.spec_from_file_location(module_name, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        print(f'ERROR importing {module_name}:')
        traceback.print_exc()
        results.append((module_name, 'import_error'))
        continue
    tests = [getattr(mod, name) for name in dir(mod) if name.startswith('test_')]
    for t in tests:
        try:
            t()
            print(f'OK: {module_name}.{t.__name__}')
            results.append((f'{module_name}.{t.__name__}', 'ok'))
        except AssertionError as e:
            print(f'FAILED: {module_name}.{t.__name__} - {e}')
            results.append((f'{module_name}.{t.__name__}', 'failed'))
        except Exception as e:
            print(f'ERROR: {module_name}.{t.__name__} - {e}')
            traceback.print_exc()
            results.append((f'{module_name}.{t.__name__}', 'error'))

ok = sum(1 for r in results if r[1]=='ok')
failed = sum(1 for r in results if r[1]=='failed')
errors = sum(1 for r in results if r[1] in ('error','import_error'))
print('\nSummary:')
print(f'  ok={ok} failed={failed} errors={errors} total={len(results)}')
if failed or errors:
    sys.exit(2)
