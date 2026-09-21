---
name: review-autofix
description: 人が autofix タグで許可した Open-Deck の BL finding を1件だけ隔離worktreeで修正し、安全ゲート後にPR化する。自動修正またはautofixを明示的に依頼されたときに使う。
---

# Review Autofix

許可判断は `review.config.json`、`review/autofix-policy.json`、共通CLIに任せる。現在の試験対象は docs-link だけ。

1. `npm run review -- doctor` でERRORや不整合がないことを確認する。
2. `npm run review -- autofix candidates` の `[OK]` 最優先1件だけを扱う。指定IDが対象外なら停止する。
3. `npm run review -- autofix start <ID>` が返す隔離worktreeだけで最小変更を行う。呼出元をstash、checkout、resetしない。
4. commit後に隔離worktreeで `npm run review -- autofix gate` を通す。範囲外変更が必要、または継続不可なら `finish --outcome blocked --note "..."` で止める。
5. 通過時だけpushとPR作成を行い、実在する番号・URLを `finish --outcome pr-opened` へ記録する。マージ、auto-merge、worktree/branch削除はしない。
6. blocked時は基点側で `npm run review -- sync` を実行し、回収待ちを解消する。

完了時はfix ID、finding ID、class、outcome、変更量、PRまたは停止理由、worktreeとbranchを報告する。
