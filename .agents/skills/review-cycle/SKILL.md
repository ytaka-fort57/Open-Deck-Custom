---
name: review-cycle
description: Open-Deck の期限到来レビュー観点を1件だけ実行し、既存の BL バックログとrun台帳を共通CLI経由で更新する。定期点検、観点レビュー、自動レビューサイクルで使う。
---

# Review Cycle

正本は `review.config.json`、`review/lenses.jsonl`、`docs/backlog/findings.jsonl`。運用境界は `docs/dev/automated-review-cycle-runbook.md` にある。

1. `npm run review -- doctor` を実行する。ERROR、残留run、lock・worktree・台帳不整合があれば勝手に修復せず停止して報告する。
2. 定期実行では `npm run review -- run --if-due --dry-run --json` で期限到来レンズを1件だけ選ぶ。`skipped: true` は正常終了。人がレンズを指定した場合だけ `--lens <ID>` を付ける。
3. 決定論レンズは `npm run review -- run --lens <ID> --json` に任せる。LLMレンズは計画の `prompt` と `files` だけを点検し、結果をJSON配列へ保存して `--findings <JSON-PATH>` 付きで実行する。空振りは `[]`。
4. `npm run backlog:validate -- --report` で既存BL台帳とレポートを検証する。

1回につき1レンズ。サイクル中にソースを修正せず、通常フローで内部のstart/add/finishを個別に呼ばない。完了時はrun ID、レンズ、outcome、走査数、登録・再検出IDを報告する。
