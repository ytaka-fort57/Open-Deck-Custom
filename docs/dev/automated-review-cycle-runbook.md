# Open-Deck 自動レビュー・自動改善 runbook

共通パッケージ [review-kit](https://github.com/ytaka-fort57/review-kit)(`node_modules/review-kit`)の CLI を、既存の `BL-*` バックログを置き換えず接続した段階5の試験運用である。
エンジンの不具合や改善はこのリポジトリで直さず、review-kit リポジトリで行って版を上げる。

## 安全境界

- 発見と修正は別サイクルにする。
- 自動修正は、人が `triaged` と `autofix:<class>` を付けた1件だけ。
- 修正は `custom` を基点に隔離worktreeで行い、現在の作業ツリーをstash・checkout・resetしない。
- 1 branch / 1 PR / 1 finding。自動マージはしない。
- 初回の許可classは `docs-link` だけ。manifest、background、storage、CI、policy、review engine(`node_modules/` と版を決める `package.json` / `package-lock.json`)、生成スキルは対象外。
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
4. worktree に `node_modules` がなければ `npm ci` を実行してから `npm run review -- autofix gate`
5. 通過時だけpush・PR作成後に `finish --outcome pr-opened`
6. blocked/abandonedは基点側の `npm run review -- sync` で回収

本運用のautofixは、この基盤が `custom` に取り込まれpushされた後に開始する。
CI の gate は基点ブランチを別ディレクトリへ checkout して `npm ci` し、その review-kit で検査する(PR 側のエンジンは使わない)。
CI が review-kit を取得するため、Actions secrets に読み取り専用の `REVIEW_KIT_TOKEN` を置いている。

## 試験期間に見る指標

2〜4週間、新規finding数、重複・再検出率、誤検出率、1サイクル時間、gate失敗率、manual検証滞留、CI実行時間を記録する。レンズ追加やautofix範囲拡大は、dry-runと一時fixtureで確認してから行う。
