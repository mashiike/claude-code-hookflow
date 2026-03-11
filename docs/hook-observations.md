# Hook stdin 観察結果

実際の Claude Code セッションで各 Hook イベントの stdin を dump して確認した結果。

## 共通フィールド

全イベントに含まれるフィールド:

```json
{
  "session_id": "uuid",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/path/to/project",
  "hook_event_name": "EventName"
}
```

## 各イベントの固有フィールド

### SessionStart

```json
{
  "source": "startup",
  "model": "claude-opus-4-6"
}
```

- `source`: `"startup"` / `"resume"` / `"clear"` / `"compact"`
- `"compact"` は `/compact` 実行時に確認済み。compact 時は SubagentStop も発火する

### SessionEnd

```json
{
  "reason": "prompt_input_exit"
}
```

- `reason`: `"clear"` / `"logout"` / `"prompt_input_exit"` / `"bypass_permissions_disabled"` / `"other"`

### UserPromptSubmit

```json
{
  "permission_mode": "default",
  "prompt": "ユーザーが入力したプロンプトのテキスト"
}
```

### PostToolUse

```json
{
  "permission_mode": "default",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/absolute/path/to/file",
    "old_string": "...",
    "new_string": "...",
    "replace_all": false
  },
  "tool_response": {
    "filePath": "/absolute/path/to/file",
    "structuredPatch": [...],
    "originalFile": "...",
    "userModified": false
  },
  "tool_use_id": "toolu_xxx"
}
```

- `tool_name`: `"Edit"` / `"Write"` / `"MultiEdit"` 等（matcher で絞っている）
- `tool_input.file_path`: **編集されたファイルの絶対パス**
- `tool_response.structuredPatch`: diff のパッチ情報

### Stop

```json
{
  "permission_mode": "default",
  "stop_hook_active": false,
  "last_assistant_message": "最後のアシスタント応答テキスト"
}
```

- `stop_hook_active`: Stop hook が現在アクティブかどうか（ループ防止用）

### TaskCompleted

```json
{
  "task_id": "1",
  "task_subject": "タスクのタイトル",
  "task_description": "タスクの説明"
}
```

- タスク情報のみ。**編集ファイル一覧は含まれない**
- `permission_mode` も含まれない

### SubagentStop

```json
{
  "permission_mode": "default",
  "agent_id": "a8643c93bf15b39fa",
  "agent_type": "",
  "stop_hook_active": false,
  "agent_transcript_path": "/path/to/subagents/agent-{agent_id}.jsonl",
  "last_assistant_message": "サブエージェントの最後の応答テキスト"
}
```

- `agent_id`: サブエージェントの識別子
- `agent_type`: エージェントタイプ（空文字列の場合あり）
- `agent_transcript_path`: サブエージェント固有の transcript ファイルパス
- `stop_hook_active`: ループ防止用（Stop と同様）
- compact 実行時に内部サブエージェントが使われるため、compact でも発火する

### Notification

```json
{
  "message": "Claude is waiting for your input",
  "notification_type": "idle_prompt"
}
```

```json
{
  "message": "Claude needs your permission to use Bash",
  "notification_type": "permission_prompt"
}
```

- `notification_type`: `"idle_prompt"` / `"permission_prompt"` （他にもある可能性あり）
- `message`: 通知メッセージのテキスト
- `permission_mode` は含まれない
- idle 状態（入力待ち）や権限確認待ちで発火する

## 設計への影響

1. **PostToolUse で編集ファイルを記録する必要がある**
   - TaskCompleted には編集ファイル情報が含まれない
   - PostToolUse の `tool_input.file_path` から取得するしかない

2. **Stop と TaskCompleted は別イベント**
   - Stop: Claude の応答が終わるたびに発火（雑談でも）
   - TaskCompleted: タスクツールで完了マークしたときのみ発火
   - hookflow のトリガーは Stop にすべきかもしれない（TaskCompleted はタスクツール依存）

3. **Stop の `stop_hook_active` でループ防止可能**
   - hook が exit 2 で失敗 → Claude が修正 → 再度 Stop → `stop_hook_active: true`
   - この値でループ検知ができる
