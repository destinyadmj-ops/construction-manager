"""A/B テストランナー
- 指定したパラメータグリッドで `bot_v2.tools.wf_batch_run` を複数実行し、結果を集約します。
- 使い方例:
  python tools/ab_test_runner.py --csv bot_v2/tools/data/btc_sample.csv --coefs 0.0001 0.001 0.01 --out results/ab_results.json
"""
import os, json, subprocess, argparse, tempfile, shutil

DEFAULT_CSV = 'bot_v2/tools/data/btc_sample.csv'


def run_ab(csv_path, coefs, indices, sides, size, strategy, atr_default, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    results = []
    for coef in coefs:
        env = os.environ.copy()
        env['REWARD_BEST_ARB_COEF'] = str(coef)
        print(f'Running coef={coef}')
        cmd = ["python", "-m", "bot_v2.tools.wf_batch_run", "--csv", csv_path, "--indices"] + [str(i) for i in indices] + ["--sides"] + sides + ["--size", str(size), "--strategy", strategy, "--atr-default", str(atr_default)]
        try:
            # use temporary working dir to avoid overwriting same report
            with tempfile.TemporaryDirectory() as td:
                proc = subprocess.run(cmd, env=env, cwd=td, capture_output=True, text=True, timeout=600)
                out = proc.stdout + '\n' + proc.stderr
                # attempt to find batch_summary in bot_v2/tools/reports
                rpt = os.path.join('bot_v2', 'tools', 'reports', 'batch_summary.json')
                if os.path.exists(rpt):
                    with open(rpt, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                else:
                    data = {'error': 'no_report', 'stdout': out}
        except Exception as e:
            data = {'error': str(e)}
        results.append({'coef': coef, 'result': data})
    with open(out_path, 'w', encoding='utf-8') as of:
        json.dump(results, of, ensure_ascii=False, indent=2)
    print('A/B test complete. Results saved to', out_path)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--csv', default=DEFAULT_CSV)
    p.add_argument('--coefs', type=float, nargs='+', default=[0.0001, 0.001, 0.01])
    p.add_argument('--indices', type=int, nargs='+', default=[0,100,200])
    p.add_argument('--sides', nargs='+', default=['buy','sell'])
    p.add_argument('--size', type=float, default=0.01)
    p.add_argument('--strategy', default='alert_d')
    p.add_argument('--atr-default', type=float, default=10.0)
    p.add_argument('--out', default='tools/ab_results.json')
    args = p.parse_args()
    run_ab(args.csv, args.coefs, args.indices, args.sides, args.size, args.strategy, args.atr_default, args.out)
