---
name: review-cycle
description: 期限到来したレビュー観点を1件だけ実行し、共通CLIを通して BL の発見事項と実行記録を更新する。定期点検・観点レビュー・自動レビューサイクルを依頼されたときに使う。
---
<!-- review-kit skills install で生成。直接編集しない。固有の注意は review/skill-notes/<スキルID>.md に書いて再生成する -->

# Review Cycle

このskillは判断や台帳操作を再実装しない。正本は `review.config.json`、`review/lenses.jsonl`、`docs/backlog/findings.jsonl` と review-kit の CLI。

1. `node node_modules/review-kit/bin/review-kit.mjs review doctor` を実行する。ERROR、残留run、lock・worktree・台帳不整合があれば勝手に修復せず停止して報告する。
2. 定期実行では `node node_modules/review-kit/bin/review-kit.mjs review run --if-due --dry-run --json` で期限到来レンズを1件だけ選ぶ。`skipped: true` なら正常終了する。人がレンズを指定した場合だけ `--lens <ID>` を付ける。
3. 決定論レンズは `node node_modules/review-kit/bin/review-kit.mjs review run --lens <ID> --json` へ任せる。LLMレンズは `plan.prompt` と `plan.files` の範囲だけを点検し、結果をJSON配列へ保存して `--findings <JSON-PATH>` 付きで実行する。空振りは `[]`。
   JSONはリポジトリ内に置き、実行後に消す。実行前に同じ引数へ `--dry-run` を付け、`registrationCheck` を確かめる。
4. `registrationCheck.ok` が `false` で `similar finding exists` が出たら、挙がった既存IDを `node node_modules/review-kit/bin/review-kit.mjs backlog show <ID>` で読み、根拠と利用者影響を比べる。
   - 同じ問題なら、そのfindingを入力から外す。追加の事実は `node node_modules/review-kit/bin/review-kit.mjs backlog update <ID> --work-note "…"` で既存IDへ残す。
   - 別の問題なら、そのfindingに `"allowSimilar": true` を付け、既存IDとの違いを `finding` に書いて流し直す。
   類似判定はタイトルの語や根拠ファイルが重なっただけでも出る。確認して別の問題と分かった発見を、類似判定を理由に捨てない。
5. `node node_modules/review-kit/bin/review-kit.mjs backlog validate --report` で台帳と生成物を検証する。

1回につき1レンズ、登録上限はCLIの計画に従う。サイクル中にソースコードを修正しない。通常フローで `review cycle start` / `backlog add` / `review cycle finish` を個別に呼ばない(類似候補を登録するときも `allowSimilar` を付けて `review run` で流す)。

完了時は run ID、レンズ、outcome、走査数、登録・再検出IDを報告する。通知の要否は `node node_modules/review-kit/bin/review-kit.mjs review health` の判定に従う。

## このリポジトリ固有の注意

- 運用境界は `docs/dev/automated-review-cycle-runbook.md`。
