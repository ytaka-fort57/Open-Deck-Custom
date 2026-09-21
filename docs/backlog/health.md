# バックログ健全性

> `npm run review -- health` が生成。直接編集しない。

生成日: 2026-09-21

## 通知

該当なし

## 件数

- 総数 35 / 未了 11（抑止中・実質終了を除く）
- 優先度（未了）: P1 0 / P2 1 / P3 10
- 状態: discovered 0 / triaged 11 / in-progress 2 / monitoring 0 / verified 20 / wont-fix 2
- 未了項目の滞留（updatedAt からの中央値）: 3 日

## 30 日以上動いていない P1

該当なし

## 実画面確認の借金（manual 未検証）

| ID | タイトル |
|---|---|
| BL-024 | 本家レビューworkflow(sync-upstream.yml)の初回動作が未確認 |

## レンズ

| ID | 周期 | 最終実行 | 経過 | 期限 | 実行回数 | 登録数 | 備考 |
|---|---|---|---|---|---|---|---|
| LENS-check-docs-links | weekly | 2026-09-21 | 0 日 | — | 2 | 2 |  |
| LENS-check-path | on-change | 2026-09-19 | 2 日 | 到来 | 1 | 0 |  |
| LENS-check-evidence | weekly | 未実行 | — | 到来 | 0 | 0 |  |
| LENS-test-quality | monthly | 未実行 | — | 到来 | 0 | 0 |  |
| LENS-docs-drift | monthly | 未実行 | — | 到来 | 0 | 0 |  |
| LENS-extension-contract | monthly | 未実行 | — | 到来 | 0 | 0 |  |

## 直近のサイクル

| runId | レンズ | 開始 | 結果 | 走査 | 登録 | 再検出 |
|---|---|---|---|---|---|---|
| RUN-2026-09-21-02 | LENS-check-docs-links | 2026-09-21 11:25 | empty | 4 | — | — |
| RUN-2026-09-21-01 | LENS-check-docs-links | 2026-09-21 11:11 | ok | 29 | BL-034 BL-035 | — |
| RUN-2026-09-19-01 | LENS-check-path | 2026-09-19 13:08 | empty | 30 | — | — |

## 自動修正

- 総数 0

該当なし
