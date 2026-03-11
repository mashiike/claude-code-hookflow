# claude-code-hookflow

> YAML-defined workflows triggered by Claude Code hooks — fmt, lint, test, and more.

Claude Code のタスク完了時に、YAML で定義したワークフロー（fmt, lint, test 等）を自動実行するプラグインです。

## インストール

```bash
claude plugin add github:mashiike/claude-code-hookflow
```

## 使い方

プロジェクトにワークフロー YAML を配置すると、Claude Code がタスクを完了するたびに自動で実行されます。

（フォーマット詳細は検討中）

## 開発

### ビルド

```bash
go build -o bin/claude-code-hookflow .
```

### ローカルデバッグ

プラグインとしてインストールせずに、プロジェクトの `.claude/settings.local.json` に直接 Hook を設定してテストできます。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-code-hookflow/bin/claude-code-hookflow"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-code-hookflow/bin/claude-code-hookflow",
            "async": true
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-code-hookflow/bin/claude-code-hookflow"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-code-hookflow/bin/claude-code-hookflow"
          }
        ]
      }
    ]
  }
}
```

`/path/to/claude-code-hookflow` をリポジトリの絶対パスに置き換えてください。

### 単体テスト

stdin に JSON を流して動作確認できます。

```bash
echo '{"session_id":"test","cwd":"/tmp/myproject"}' | ./bin/claude-code-hookflow
```

## ライセンス

MIT
