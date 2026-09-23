# 残課題スキーマ

共通の定義は `node_modules/review-kit/docs/schema.md`。ここには本リポジトリの語彙と固有の注意を書く。

## 固定値

- `category`: `uiux`、`architecture`、`persistence`、`release`、`validation`、`security`、`performance`、`feature`、`i18n`
- `app`: `content`、`custom`、`helper`、`background`、`tests`、`docs`、`config`(`review.config.json` の `vocabulary.components`)
- `area`: `interaction`、`state`、`responsive`、`accessibility`、`visual`、`copy`、`navigation`、`layout`、`feedback`、`performance`、`architecture`、`persistence`、`migration`、`release`、`validation`、`security`、`i18n`、`lifecycle`、`history`、`css`
- `priority`: `P1`、`P2`、`P3`
- `status`: `discovered`、`triaged`、`in-progress`、`monitoring`、`verified`、`wont-fix`
- `verificationRequired`: `code`、`manual`、`both`
- 検証方法: `code`、`manual`
- 検証結果: `passed`、`failed`、`not-checked`

`category` は作業系統、`app` は対象の構成要素、`area` は問題領域を表す。

| `app` | 対象 |
|---|---|
| `content` | 本家由来の `content.js`(デッキ本体) |
| `custom` | `extensions/custom/*`(独自コード) |
| `helper` | 本家由来の `extensions/*.js` と iframe へ注入する `*_helper.js` |
| `background` | `background.js` |
| `tests` | `tests/`(Node 回帰テスト、Playwright E2E、静的検査) |
| `docs` | `docs/`、`README`、locale の文言 |
| `config` | `manifest*.json`、`package.*`、`verify.*`、`.github/` |

## 状態別の条件

| 状態 | 条件 |
|---|---|
| `discovered` | `finding` と `evidence` を記録する |
| `triaged` | `priority`、`impact`、`proposal`、`acceptanceCriteria` を記録する |
| `in-progress` | `workNotes` または `relatedCommits` を記録する |
| `monitoring` | 通常時に再現できない異常系。`in-progress` / `verified` とは別状態 |
| `verified` | `verificationRequired` が要求する検証方法を `passed` にする |
| `wont-fix` | `decision.reason` と `decision.decidedAt` を記録する |

通常は `discovered → triaged → in-progress → verified` の順に進める。
初期監査時点ですでに対応へ着手している項目に限り `discovered → in-progress` を許可する。
`verified` から再発・条件変更で `in-progress` へ戻す場合は `workNotes` に理由を残す。

## 根拠

`evidence` は空配列にできない。`type=code` はリポジトリルート相対の `file` を持ち、
絶対パス・UNC パス・`..` によるルート外参照は使用しない。

`sourceDocument` は元ドキュメントを追跡する任意項目。
`docs/code-audit-2026-09-18.md#R-11` のように、リポジトリ相対パスと任意のセクションを記録する。

`type=manual` は `screen`、`viewport`、`steps`、`observed`、`checkedAt`、`result` を持つ。
スクリーンショットを保存する場合は、リポジトリ内の相対パス(`docs/backlog/evidence/...`)を `screenshot` に記録する。

## 本リポジトリ固有の注意

- `verificationRequired: manual` は「ログイン済み X の実ブラウザーで確認しないと判定できない」項目に付ける。
  Playwright E2E はローカル fixture 上で動くため `code` として記録する。
- `content.js` の行番号は本家更新と分割で大きくずれる。着手時に
  `npm run backlog:update -- BL-0NN --evidence …` で取り直す。
- 本家ファイルの死コード削除・関数移動は [upstream-port-log.md](../upstream-port-log.md) にも残す。

## 抑止(suppress)

`suppress` は任意項目で、`{ "until": "YYYY-MM-DD", "reason": "…", "createdAt": "YYYY-MM-DD" }` を持つ。
`npm run backlog:suppress -- BL-0NN --until <日付> --reason "…"` で設定し、`--clear` で解除する。

期限内の `suppress` と `verified` / `monitoring` / `wont-fix` は「抑止中」として扱い、
同じ内容を再登録しようとしても新規追加しない(`report.md` の「抑止中」節に出る)。

同一性の判定は `category` + `app` + 正規化したタイトル + 根拠ファイルの集合から導出する
fingerprint による(review-kit の `computeFingerprint`)。**行番号は含めない**ため、
コミットで行がずれても同じ発見事項とみなす。fingerprint はレコードに保存せず、毎回計算する。
