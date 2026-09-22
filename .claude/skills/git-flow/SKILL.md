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
codex/upstream-port-YYYYMMDD  本家更新の意味を custom へ再実装する作業ブランチ(merge しない)
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
- 末尾に共著者行を付ける。モデル名は会話で指示された共著者行をそのまま使い、ここに固定しない

```bash
git add <path>
git commit -F - <<'EOF'
fix: 要約

なぜこの変更が必要かを書く。

Co-Authored-By: <指示された共著者行>
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

`upstream/Release` を `custom` へ merge / cherry-pick しない。カスタム側の構造差が大きいため、
変更意図を読み、必要な部分だけを現在の設計へ再実装する。手順の正本は
[docs/open-deck-fork-project-setup.md の「16. 本家更新をレビューして意味移植する」](../../../docs/open-deck-fork-project-setup.md)。

```bash
git fetch upstream Release
base=$(tr -d '[:space:]' < .github/upstream-base)
latest=$(git rev-parse upstream/Release)
git log --reverse --oneline "$base..$latest"
git diff --name-status "$base..$latest"
```

1. 各コミットを「採用」「対応不要」「既に独自実装済み」に分類する
2. 採用分は `custom` から `codex/upstream-port-YYYYMMDD` を切り、関連テストを足してから意味だけを再実装する
3. `.\verify.ps1`(または `./verify.sh`)を通す
4. 同じ変更で `.github/upstream-base` を `$latest` へ進め、[docs/upstream-port-log.md](../../../docs/upstream-port-log.md) へ全コミットの判断理由を追記する

独自コードは `extensions/custom/` に隔離してあるため、本家ファイルの変更は最小に保つ。
本家ファイルの構造整理(関数移動・死コード削除)も upstream-port-log.md に残す。

## 注意

- 現在のチェックアウトは `Release` ではなく `custom` 起点で作業する
- 破壊的な操作（`reset --hard`、`push --force`）は事前に確認を取る
