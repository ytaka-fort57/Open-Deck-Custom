# Open-Deck 自動レビュー・自動改善 runbook

usage_dashboard の共通CLIを、既存の `BL-*` バックログを置き換えず接続した段階5の試験運用である。

## 安全境界

- 発見と修正は別サイクルにする。
- 自動修正は、人が `triaged` と `autofix:<class>` を付けた1件だけ。
- 修正は `custom` を基点に隔離worktreeで行い、現在の作業ツリーをstash・checkout・resetしない。
- 1 branch / 1 PR / 1 finding。自動マージはしない。
- 初回の許可classは `docs-link` だけ。manifest、background、storage、CI、policy、review engineは対象外。
- worktreeとbranchはPR状態と未回収差分を人が確認するまで削除しない。

## 通常のレビュー

1. `npm run review -- doctor`
2. `npm run review -- run --if-due --dry-run --json`
3. 決定論レンズはそのまま `run --lens <ID> --json`
4. LLMレンズはdry-runの `prompt` / `files` 内だけを点検し、構造化JSONを `--findings` で渡す
5. `npm run backlog:validate -- --report`

期限到来なしは `skipped: true` の正常no-op。1回1レンズ、登録上限は設定値に従う。

## 自動修正

1. `npm run review -- autofix candidates`
2. 人が許可した候補を `npm run review -- autofix start BL-0NN`
3. 出力されたworktree内だけで修正・commit
4. `npm run review -- autofix gate`
5. 通過時だけpush・PR作成後に `finish --outcome pr-opened`
6. blocked/abandonedは基点側の `npm run review -- sync` で回収

本運用のautofixは、この基盤が `custom` に取り込まれpushされた後に開始する。

## 試験期間に見る指標

2〜4週間、新規finding数、重複・再検出率、誤検出率、1サイクル時間、gate失敗率、manual検証滞留、CI実行時間を記録する。レンズ追加やautofix範囲拡大は、dry-runと一時fixtureで確認してから行う。
