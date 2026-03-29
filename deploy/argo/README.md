Argo Rollout Canary

File: `deploy/argo/rollout_canary.yaml`

概要:
- Argo Rollouts を使って `REWARD_BEST_ARB_COEF` を段階的に更新するための例 manifest。
- 事前に Argo Rollouts CRD とコントローラがクラスターにインストールされていることを確認してください。

使い方例:
1. `kubectl apply -f deploy/argo/rollout_canary.yaml`
2. Argo Rollouts UI もしくは `kubectl argo rollouts get rollout <name> --watch` で進捗を監視します。

注意:
- manifest 内の `value: "0.0001"` はサンプル値です。実際の deployment/ConfigMap/Envvar の管理方法に応じて適切に調整してください。
