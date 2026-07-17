---
name: git-flow
description: このリポジトリ(Open-Deck カスタム版 fork)の git 作業を定型手順で行う。作業ブランチの作成、コミット、custom への fast-forward マージ、本家 upstream の取り込みなど。「ブランチを切って」「コミットして」「custom にマージして」「本家を取り込んで」といった依頼で使う。
---

# Open-Deck カスタム版の git 手順

fork 運用のブランチ構成と手順は [docs/open-deck-fork-project-setup.md](../../../docs/open-deck-fork-project-setup.md) が正。
迷ったらそちらを読む。

## ブランチ構成

```text
upstream/Release   本家 kawa-nobu/Open-Deck。既定ブランチは main ではなく Release
origin/Release     本家追従用。独自変更を直接入れない
origin/custom      カスタム版の統合ブランチ。作業ブランチはここから切る
feature/*          機能追加
fix/*              不具合修正
sync/upstream      本家更新を custom へ取り込む一時ブランチ
```

`upstream` へ push しない。変更の送信先は常に `origin`。

## 作業ブランチを切る

```bash
git switch custom
git pull --ff-only origin custom
git switch -c fix/xxx     # または feature/xxx
```

## コミット

- メッセージは日本語。1行目は `種別: 要約`（`feat:` `fix:` `docs:` `chore:`）
- 何をしたかではなく、なぜそうしたかを本文に書く
- 小さい単位で分ける。別事象を1つのコミットに混ぜない
- 末尾に共著者行を付ける

```bash
git add <path>
git commit -F - <<'EOF'
fix: 要約

なぜこの変更が必要かを書く。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

PowerShell の here-string (`@'...'@`) は Bash ツールでは使えない。ヒアドキュメントを使う。

## custom へマージする

このプロジェクトでは fast-forward マージで運用する（マージコミットを作らない）。

```bash
git push -u origin <作業ブランチ>
git switch custom
git merge --ff-only <作業ブランチ>
git push origin custom
```

`--ff-only` が失敗する場合は custom が先に進んでいる。作業ブランチを rebase してから再実行する。

## 本家の更新を取り込む

```bash
git fetch upstream
git switch Release
git merge --ff-only upstream/Release
git push origin Release
git switch -c sync/upstream custom
git merge Release
```

競合しやすいのは `manifest.json` と `manifest_firefox.json` の content script 配列。
独自の入口（`extensions/custom/*`）が消えていないか必ず確認する。
独自コードは `extensions/custom/` に隔離してあるため、本家ファイルの変更は最小に保つ。

## 注意

- 現在のチェックアウトは `Release` ではなく `custom` 起点で作業する
- 破壊的な操作（`reset --hard`、`push --force`）は事前に確認を取る
