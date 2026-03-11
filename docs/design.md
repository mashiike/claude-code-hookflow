# 設計メモ

## 確定事項

- **トリガーは TaskCompleted**: PreToolUse/PostToolUse だと編集のたびに CI が回って邪魔。タスク完了時に 1 回だけ実行する
- **YAML でワークフロー定義**: ユーザーがプロジェクトごとにワークフローを定義できる
- **失敗時のフィードバック**: CI が失敗したら Claude に戻して修正させる

## 検討中・未決定

### YAML フォーマット
- どんなフィールドを持つか
- ファイルの配置場所（`.claude/hookflow/*.yaml`？プロジェクトルート？）

### 編集ファイルの把握方法
- PostToolUse (async) で state ファイルに記録する案
- TaskCompleted の stdin から得られる情報だけで足りるか？

### on_failure の挙動
- `block` / `warn` / `ignore` の区分は引き継ぎ資料にあったが未確定
- `TaskCompleted` で exit 0 + stdout JSON が additionalContext として Claude に届くか未検証

### YAML パーサ
- Node.js 標準に YAML パーサがない
- js-yaml を vendor 同梱？JSON のみにする？別の方法？

## Hook 選定

| Hook | 用途 | 備考 |
|------|------|------|
| `UserPromptSubmit` | state リセット | 編集記録方式を採用する場合に必要 |
| `PostToolUse` (async) | 編集ファイル記録 | 編集記録方式を採用する場合に必要 |
| `TaskCompleted` | ワークフロー実行 | **確定** |

## 未検証事項

- [ ] `TaskCompleted` の stdin にどんな情報が含まれるか（編集ファイル一覧が取れるなら state 管理不要かも）
- [ ] exit 0 + stdout JSON → additionalContext として Claude に届くか
- [ ] `CLAUDE_PLUGIN_ROOT` 展開の既知バグ (issue #18517) の影響
