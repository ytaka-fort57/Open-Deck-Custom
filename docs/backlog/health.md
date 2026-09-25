# バックログ健全性

> `npm run review -- health` が生成。直接編集しない。

生成日: 2026-09-25

## 通知

該当なし

## 件数

- 総数 75 / 未了 13（抑止中・実質終了を除く）
- 優先度（未了）: P1 0 / P2 5 / P3 8
- 状態: discovered 7 / triaged 9 / in-progress 0 / monitoring 0 / verified 56 / wont-fix 3
- 未了項目の滞留（updatedAt からの中央値）: 3 日

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
| LENS-check-docs-links | weekly | 2026-09-21 | 4 日 | — | 2 | 2 |  |
| LENS-check-path | on-change | 2026-09-19 | 6 日 | 到来 | 1 | 0 |  |
| LENS-check-evidence | weekly | 2026-09-25 | 0 日 | — | 1 | 0 |  |
| LENS-test-quality | monthly | 2026-09-25 | 0 日 | — | 1 | 3 |  |
| LENS-docs-drift | monthly | 2026-09-25 | 0 日 | — | 2 | 1 |  |
| LENS-extension-contract | monthly | 2026-09-25 | 0 日 | — | 4 | 2 |  |

## 直近のサイクル

| runId | レンズ | 開始 | 結果 | 走査 | 登録 | 再検出 |
|---|---|---|---|---|---|---|
| RUN-2026-09-25-06 | LENS-extension-contract | 2026-09-25 05:35 | ok | 68 | BL-075 | — |
| RUN-2026-09-25-05 | LENS-docs-drift | 2026-09-25 05:35 | ok | 25 | BL-074 | — |
| RUN-2026-09-25-04 | LENS-test-quality | 2026-09-25 04:43 | ok | 41 | BL-071 BL-072 BL-073 | — |
| RUN-2026-09-25-03 | LENS-docs-drift | 2026-09-25 04:43 | failed | 25 | — | — |
| RUN-2026-09-25-02 | LENS-extension-contract | 2026-09-25 04:43 | failed | 20 | — | — |
| RUN-2026-09-25-01 | LENS-check-evidence | 2026-09-25 04:38 | empty | 1 | — | — |
| RUN-2026-09-22-02 | LENS-extension-contract | 2026-09-22 13:34 | failed | 8 | — | — |
| RUN-2026-09-22-01 | LENS-extension-contract | 2026-09-22 13:33 | failed | 65 | BL-044 | — |
| RUN-2026-09-21-02 | LENS-check-docs-links | 2026-09-21 11:25 | empty | 4 | — | — |
| RUN-2026-09-21-01 | LENS-check-docs-links | 2026-09-21 11:11 | ok | 29 | BL-034 BL-035 | — |

## 自動修正

- 総数 0

該当なし
