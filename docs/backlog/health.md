# バックログ健全性

> `npm run review -- health` が生成。直接編集しない。

生成日: 2026-09-23

## 通知

該当なし

## 件数

- 総数 70 / 未了 9（抑止中・実質終了を除く）
- 優先度（未了）: P1 0 / P2 2 / P3 7
- 状態: discovered 2 / triaged 10 / in-progress 0 / monitoring 0 / verified 55 / wont-fix 3
- 未了項目の滞留（updatedAt からの中央値）: 1 日

## 30 日以上動いていない P1

該当なし

## 実画面確認の借金（manual 未検証）

| ID | タイトル |
|---|---|
| BL-058 | ヘッダー削除ルールが main_frame を含み、通常閲覧の x.com でもCSPを外している |
| BL-059 | host_permissions と web_accessible_resources が必要以上に広い |
| BL-065 | 入力フォーカス中にカラムが消えると自動更新が止まったままになる疑い |

## レンズ

| ID | 周期 | 最終実行 | 経過 | 期限 | 実行回数 | 登録数 | 備考 |
|---|---|---|---|---|---|---|---|
| LENS-check-docs-links | weekly | 2026-09-21 | 2 日 | — | 2 | 2 |  |
| LENS-check-path | on-change | 2026-09-19 | 4 日 | 到来 | 1 | 0 |  |
| LENS-check-evidence | weekly | 未実行 | — | 到来 | 0 | 0 |  |
| LENS-test-quality | monthly | 未実行 | — | 到来 | 0 | 0 |  |
| LENS-docs-drift | monthly | 未実行 | — | 到来 | 0 | 0 |  |
| LENS-extension-contract | monthly | 未実行 | — | 到来 | 2 | 1 |  |

## 直近のサイクル

| runId | レンズ | 開始 | 結果 | 走査 | 登録 | 再検出 |
|---|---|---|---|---|---|---|
| RUN-2026-09-22-02 | LENS-extension-contract | 2026-09-22 13:34 | failed | 8 | — | — |
| RUN-2026-09-22-01 | LENS-extension-contract | 2026-09-22 13:33 | failed | 65 | BL-044 | — |
| RUN-2026-09-21-02 | LENS-check-docs-links | 2026-09-21 11:25 | empty | 4 | — | — |
| RUN-2026-09-21-01 | LENS-check-docs-links | 2026-09-21 11:11 | ok | 29 | BL-034 BL-035 | — |
| RUN-2026-09-19-01 | LENS-check-path | 2026-09-19 13:08 | empty | 30 | — | — |

## 自動修正

- 総数 0

該当なし
