---
name: review-autofix
description: 人が autofix タグで許可した BL の発見事項を1件だけ隔離worktreeで自動修正し、共通CLIのゲートを通してPRを作る。自動修正・autofixを明示的に依頼されたときに使う。
---
<!-- review-kit skills install で生成。直接編集しない。固有の注意は review/skill-notes/<スキルID>.md に書いて再生成する -->

# Review Autofix

このskillは許可判断やゲートを再実装しない。正本は `review.config.json`、`review/autofix-policy.json`、review-kit の CLI。

1. `npm run review -- doctor` を実行し、ERRORや不整合があれば勝手に修復せず停止する。
2. `npm run review -- autofix candidates` から `[OK]` の最優先1件だけを選ぶ。指定IDが対象外なら何もしない。
3. `npm run review -- autofix start <ID>` が返した隔離worktreeだけで、表示された範囲・上限・受入条件に沿う最小変更を行う。呼出元をstash・checkout・resetしない。
4. 隔離worktreeに `node_modules` がなければ `npm ci` を実行してから、commit後に `npm run review -- autofix gate` を通す。CLIが継続不可を返す、または範囲外変更が必要なら `npm run review -- autofix finish --outcome blocked --note "..."` で止める。
5. 通過時だけpushとPR作成を行い、実在するPR番号・URLで `npm run review -- autofix finish --outcome pr-opened ...` を記録する。マージ、auto-merge、worktree/branch削除はしない。
6. blocked時は基点ブランチ側で `npm run review -- sync` を実行し、回収待ちが解消したことを確認する。

`package.json`、`package-lock.json`、`node_modules/`、`review.config.json`、`review/` は変更しない(ゲートで拒否される)。

完了時は fix ID / finding ID / class / outcome、変更量、PR URLまたは停止理由、隔離worktreeとbranchを報告する。通知の要否は `npm run review -- health` の判定に従う。

## このリポジトリ固有の注意

- 基点ブランチは `custom`。現在の試験対象は `docs-link` 区分だけ。
- 運用境界は `docs/dev/automated-review-cycle-runbook.md`。
