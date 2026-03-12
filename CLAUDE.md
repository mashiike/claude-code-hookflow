# CLAUDE.md — claude-code-hookflow 開発ガイド

## プロジェクト概要

Claude Code プラグイン。Hook イベントを使って、タスク完了時に YAML 定義のワークフロー（fmt, lint, test 等）を自動実行する。

## 設計の状態

- コアコンセプト（Stop/TaskCompleted でワークフロー実行）は確定
- YAML フォーマット、状態管理の詳細は検討中
- 詳細は `docs/design.md` を参照

## 技術スタック

- TypeScript — コアロジック
- esbuild — 単一 JS ファイルにバンドル
- npm — パッケージマネージャー
- vitest — テスト
- Claude Code Plugin Marketplace 形式

## ディレクトリ構成

```
src/                               # TypeScript ソース
  index.ts                         # エントリーポイント
  app.ts                           # イベントハンドラー
  hook-event.ts                    # HookEvent 型 + パーサー
  state.ts                         # State 管理
  __tests__/                       # テスト
plugins/hookflow/                  # プラグインとして配布される部分
  .claude-plugin/plugin.json       # プラグインマニフェスト
  hooks/hooks.json                 # Hook 定義
  scripts/hook.sh                  # node 起動ラッパー
  dist/                            # ビルド成果物（CI がコミット）
.claude-plugin/marketplace.json    # marketplace マニフェスト
docs/                              # 設計ドキュメント
```

## ビルド

```bash
npm run build
```

## ローカル開発

```bash
task install-local   # ビルド + hooks を .claude/settings.local.json に注入
task uninstall-local  # hooks を削除
```
