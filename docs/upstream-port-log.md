# 本家変更の意味移植ログ

本家`kawa-nobu/Open-Deck:Release`を直接mergeせず、変更意図を確認してカスタム版の現在構造へ再実装する。確認済みの位置は[`.github/upstream-base`](../.github/upstream-base)で管理する。

## 運用ルール

- 基準SHAから最新SHAまでの全コミットを「採用」「対応不要」「既に独自実装済み」のいずれかに分類する。
- 採用する場合も原則としてmerge／cherry-pickせず、関連テストを先に追加して意味単位で実装する。
- 全コミットを分類し、必須検証と実ブラウザー確認を終えたPRでのみ基準SHAを進める。
- 対応不要の変更も理由を残す。これにより次回レビューで同じ変更を読み直さない。

## 記録

| 確認日 | 範囲 | 判断 | 実装・検証 |
| --- | --- | --- | --- |
| 2026-07-18 | 初期基準 `aae4fdb6b5e619f47cbad3606dd6538f5692824a` | カスタム版の作成元として確認済み | 以後の更新を週次workflowで検知する |
| 2026-09-19 | R-14 の死コード整理 | 対応不要: 到達不能なtestmode/Brave分岐、未使用のothersns・iframe幅判定・空CSS、無効なrack `.value`代入、stale判定、コメントアウト旧コード、デバッグ出力。ロード失敗検出を実装しないため `watch_load_column` と無動作テストも削除 | `content.js` / `extensions/custom/column_dom.js` / `extensions/utils_helper.js`、Node回帰テストで不在を確認 |
| 2026-09-22 | BL-019 / BL-020 の重複整理 | 採用なし(構造整理): helper注入手順を `extensions/custom/helper_injector.js` へ集約し、`extensions/utils.js` / `extensions/auto_reload.js` / `extensions/media_viewer_block.js` / `extensions/text_review.js` の Init から呼ぶ。init CustomEvent は bubbles/composed 付きへ統一(helper 側は capture で受けるため受信結果は不変)。`text_review.js` の `EscapeHTML` / `CreateRandomID` は `safe_values` へ委譲(`'` のエスケープを safe_values 側へ追加)。`content.js` の `create_random_id` も同じ実体を参照し、グローバルな Shift 追跡(keydown/keyup)は `event.shiftKey` へ置換 | `content.js` / `extensions/utils.js` / `extensions/auto_reload.js` / `extensions/media_viewer_block.js` / `extensions/text_review.js`、`node tests/run.mjs` 140/140、`npm run test:e2e` 7/7、`verify.ps1` OK |
| 2026-09-22 | BL-040 / BL-041 の初期化・文章校正境界整理 | 採用なし(構造整理): `content.js` のカラム拡張初期化を対象型付きregistryへ集約し、`text_review.js` の指摘正規化・previewモデル・選択適用を `extensions/custom/text_review_model.js` へ分離。既存の対象型、load再初期化、media token登録、UTF-16 offset契約、UI通信を維持 | Node回帰テスト、Playwright E2E、配布検証で確認 |
| 2026-09-23 | BL-047 の配布手順一本化 | 採用なし(構造整理): 本家由来の `package.ps1` / `package.sh` と独自の `verify.ps1` / `verify.sh` が持っていたZIP名・同梱entry・manifest入れ替え・ZIP書き出しを `scripts/package.mjs` へ集約し、4スクリプトは node を呼ぶだけにした。ZIP名は公開側(旧 package.sh)の小文字 `Open-Deck_chromium_` / `Open-Deck_firefox_` に統一。本家で配布手順が変わった場合は `scripts/package.mjs` の `PACKAGE_ENTRIES` / `TARGETS` へ意味移植する | `scripts/package.mjs`、`tests/package.test.mjs`、旧 `package.ps1`(Compress-Archive)出力と entry 単位で欠落・余剰・内容差なし、`verify.ps1` / `verify.sh` OK |
| 2026-09-23 | BL-051 / BL-053 / BL-061 / BL-062 / BL-063 の本家ファイル修正 | 採用なし(構造整理・不具合修正): `content.js` のカラムHTML骨格と設定パネルを `extensions/custom/column_template.js` へ移し、`default_element` は `build()` 呼び出しだけにした(生成HTMLは移行前とバイト一致)。プロファイル削除時の `last_load_profile` 補正を `splice` と同じ同期区間へ移し、`save_current_profile` は存在しない番号へ書かない。`run()` ごとの `deck.css` の重複挿入を止めた。`background.js` は文章校正の送信値を文字列・25,000文字以内に限定し、API制限の監視へ twitter.com を追加。本家で同じ箇所が変わった場合は、テンプレートは `column_template.js` の `COLUMN_TYPES` へ意味移植する | `node tests/run.mjs`、`npx playwright test`、`scripts/package.mjs build/check` |
| 2026-09-26 | デッキ起動URLの判定 | 採用なし(不具合修正): `content.js` の `location.href` 完全一致(`https://x.com/run-opdeck` / `https://twitter.com/run-opdeck`)を `extensions/custom/deck_url.js` の `is_deck_url` へ置換。popup が開く twitter.com から x.com へのリダイレクトでクエリが付くとデッキが起動せず X の 404 のままになるため、https・x.com / twitter.com とそのサブドメイン・パス `/run-opdeck`(末尾スラッシュ可)で判定し、クエリとハッシュは無視する。本家で起動判定が変わった場合は `deck_url.js` へ意味移植する | `tests/deck_url.test.mjs`、`tests/e2e/deck-url.spec.mjs`(修正前は失敗、修正後は成功)、`node tests/run.mjs`、`npx playwright test` |

## 追記テンプレート

```markdown
| YYYY-MM-DD | `base..latest` | 採用: ... / 対応不要: ... / 既存対応: ... | PRまたはcommit、`verify`結果、ブラウザー確認結果 |
```
