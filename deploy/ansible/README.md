Ansible Canary Playbook

File: `deploy/ansible/update_reward_coef.yml`

概要:
- Kubernetes 環境で `REWARD_BEST_ARB_COEF` を更新し、canary ロールアウト手順（重み1→5→25→100）を実行する簡易 Playbook。
- この Playbook は `kubectl` と `community.kubernetes` コレクションが利用可能であることを前提とします。

使い方例:
```bash
ansible-galaxy collection install community.kubernetes
ansible-playbook deploy/ansible/update_reward_coef.yml -e "k8s_namespace=default deployment_name=trading-bot container_name=trading-bot coef=0.0001"
```

注意:
- Argo Rollouts を使用している場合は `kubectl patch rollout` コマンドを使っています。Rollout リソース名が異なる場合は変数を合わせてください。
- Production では事前にバックアップ/ロールバック手順を確認してください。
