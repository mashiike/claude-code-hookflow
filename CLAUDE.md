# CLAUDE.md — claude-code-hookflow 開発ガイド

## プロジェクト概要

Claude Code プラグイン。TaskCompleted Hook を使って、タスク完了時に YAML 定義のワークフロー（fmt, lint, test 等）を自動実行する。

## 設計の状態

- コアコンセプト（TaskCompleted でワークフロー実行）は確定
- YAML フォーマット、状態管理の詳細は検討中
- 詳細は `docs/design.md` を参照

## 技術スタック

- Go — コアロジック（シングルバイナリ配布）
- Claude Code Plugin Marketplace 形式

## ディレクトリ構成

```
marketplace.json                   # marketplace マニフェスト
plugins/hookflow/                  # プラグインとして配布される部分
  .claude-plugin/plugin.json       # プラグインマニフェスト
  hooks/hooks.json                 # Hook 定義
  scripts/hook.sh                  # バイナリ起動ラッパー
  bin/                             # バイナリ配置先（.gitignore）
internal/app/                      # コアロジック（package app）
main.go                            # エントリーポイント
docs/                              # 設計ドキュメント
```

## ビルド

```bash
go build -o plugins/hookflow/bin/claude-code-hookflow .
```
