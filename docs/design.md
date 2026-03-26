# 設計メモ

## 確定事項

- **トリガーは Stop + TaskCompleted**: `on` フィールドで制御。デフォルト両方
- **YAML でワークフロー定義**: GitHub Actions 風の構文（`on`, `paths`, `jobs`, `steps`）
- **失敗時のフィードバック**: Stop → `{decision: "block", reason}` で Claude にフィードバック。TaskCompleted → exit 2 + stderr
- **ファイル配置**: `.claude/hookflows/*.yaml` (project) / `~/.claude/hookflows/*.yaml` (global)
- **失敗制御**:
  - `continue: bool` は step > job > workflow の順で cascade。`continue: true` な step の失敗は job を失敗させない
  - `stop_reason: string` は `continue` とは独立に step > job > workflow の順で cascade
  - 全 job 成功 → Claude は停止。1つでも job 失敗 → Claude をブロックして修正させる
- **失敗時の state 退避**: ワークフロー失敗時に `last_failed_run.json` にコピー。次の `UserPromptSubmit` で systemMessage として Claude に注入
- **テンプレートパイプフィルタ**: `${{ matched_dirs | prefixed './' }}` でディレクトリに `./` を付与する等
- **パス管理**: cwd 配下は相対パス、外部は絶対パス。`external_files: true` で外部ファイルもマッチ対象

## Hook 構成

| Hook | 用途 | 同期/非同期 |
|------|------|-----------|
| `UserPromptSubmit` | state リセット、前回失敗時は systemMessage 注入 | 同期 |
| `PostToolUse` (Write/Edit/MultiEdit) | 編集ファイル記録 | 非同期 |
| `Stop` | ワークフロー実行、失敗時 state 退避 | 同期 |
| `TaskCompleted` | ワークフロー実行、失敗時 state 退避 | 同期 |
| `SubagentStart` | subagent state を Fork（parent changed_files をスナップショット） | 非同期 |
| `SubagentStop` | ワークフロー実行（subagent の changed_files のみ）、失敗時 state 退避 | 同期 |
| `SessionEnd` | state ファイル + 退避ファイル + subagent state 削除 | 同期 |

## Subagent State Fork モデル

- `SubagentStart` 時にメイン state の `changed_files` をスナップショットし、subagent 用の state を作成
- `PostToolUse` は `agent_id` の有無でメイン/subagent の state に振り分け
- `SubagentStop` 時は subagent の `changed_files` のみでワークフロー実行
- parent の変更はテンプレートコンテキストの `state.parent_changed_files` で参照可能
- ワークフロー YAML の `agent_type` フィールドでサブエージェントのタイプによるフィルタが可能

State ディレクトリ構造:
```
{transcript_dir}/{transcript_name}/hookflow/
  state.json                          ← メイン
  subagents/{agent_id}/state.json     ← サブエージェントごと
```

## 未実装

- `needs` (job 依存関係) による実行順制御
