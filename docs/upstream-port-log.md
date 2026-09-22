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

## 追記テンプレート

```markdown
| YYYY-MM-DD | `base..latest` | 採用: ... / 対応不要: ... / 既存対応: ... | PRまたはcommit、`verify`結果、ブラウザー確認結果 |
```
