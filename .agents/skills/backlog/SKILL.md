---
name: backlog
description: 発見事項(不具合・リファクタ候補・実機確認待ち・保留機能)を docs/backlog/findings.jsonl へ登録し、状態を進め、検証結果を記録する。監査結果の掲載、対応状況の更新、検証済みへの移行、report の再生成を依頼されたときに使う。
---
<!-- review-kit skills install で生成。直接編集しない。固有の注意は review/skill-notes/<スキルID>.md に書いて再生成する -->

# Backlog

## Overview

発見事項の正本は `docs/backlog/findings.jsonl`、人が読む一覧は `docs/backlog/report.md`。どちらも CLI 経由で更新し、直接編集しない。
CLI はリポジトリのルートで `node node_modules/review-kit/bin/review-kit.mjs backlog <サブコマンド>` として呼ぶ(npm scripts を経由しない)。
フィールドの定義と状態遷移は `node_modules/review-kit/docs/schema.md`。JSON 入力の規則、手動検証の必須項目、エラーごとの対処は、この `SKILL.md` と同じディレクトリの `reference.md` にある。必要になったときだけ読む。

- `docs/backlog/report.md` と `docs/backlog/findings.jsonl` は件数に比例して大きくなるため、読まない。
- 一覧は `list --open`(未完了だけ)、1 件の詳細は `show BL-0NN`。どちらも `--fields id,title,status,finding` のように項目を絞れる。機械的に読むなら `list --jsonl --fields …`(1 行 1 件)。全フィールドを整形して出す `list --json` は使わない。
- 書き込み(`add` / `update` / `verify` / `suppress`)は、そのたびに台帳を検証して `docs/backlog/report.md` を作り直す。個別に `report` を呼ばない。
- 2 件以上を扱うときは `--input <file.json>` で 1 回にまとめる(`add` / `update` / `verify`)。1 件でも失敗したら何も書かれず、失敗は全件分まとめて `input[N]: …` で返る。先に `--dry-run` で確かめる。

## Preconditions

- `node node_modules/review-kit/bin/review-kit.mjs backlog preflight` を 1 回実行する。ロック、台帳の未コミット変更、未完了の件数(状態別・優先度別)がまとめて出る。
  - `ledger changes` があれば、それが今回の作業の前提か別作業かを判断してから進める。
  - `lock: held` なら、`alive=true` は終了を待つ。`alive=false` でも保持プロセスを確かめてから解除する。確認せずに消さない。
- 重複の確認は `add --dry-run` に任せる(同一 fingerprint と類似をすべての件について返す)。事前に全件を一覧しない。

## Workflow

### 追加する

1. 発見事項を**責務・利用者影響ごとに**分ける。監査結果をまとめて 1 件に詰め込まない。
2. `evidence` を先に確定する。リポジトリルート相対の `file:lines` で、絶対パス・UNC・`..` を使わない。空にはできない。
3. JSON(1 件のオブジェクトかその配列)をスクラッチ領域に書き、`node node_modules/review-kit/bin/review-kit.mjs backlog add --input <file.json> --dry-run` → `--dry-run` なしで登録する。JSON はリポジトリへ残さない。
   - 必須: `app`(`content` / `custom` / `helper` / `background` / `tests` / `docs` / `config`)、`area`(`review.config.json` の `vocabulary.areas`)、`priority`(`P1`/`P2`/`P3`)、`title`、`finding`、`impact`、`proposal`、`evidence`。
   - `category` は作業系統(`uiux` / `architecture` / `persistence` / `release` / `validation` / `security` / `performance` / `feature` / `i18n`)。`verificationRequired` は、実画面・実機を見ないと判定できない項目にだけ `manual` / `both`、テストやコードで判定できるなら `code`。
4. 登録結果は `add` の出力(`BL-0NN added` / `re-detected` / `suppressed`)で確かめる。1 件ずつ `show` し直さない。
5. `similar finding exists` が出たら、提示された ID を `show` で読んでから判断する(`reference.md` の Failure handling)。

### 状態を進める

1. `discovered → triaged → in-progress → verified` の順に進める。初期登録時点で着手済みの項目に限り `discovered → in-progress` を許可する。
2. `node node_modules/review-kit/bin/review-kit.mjs backlog update BL-0NN --status <状態> --work-note "<条件と対応>"`。`triaged` 以降は `acceptanceCriteria`、`in-progress` には `workNotes` か `relatedCommits` が要る。
3. 異常系を通常時に再現できない項目は `in-progress` から `monitoring` へ移す。`wont-fix` には `--reason` を渡す。

### 検証を記録する

1. `node node_modules/review-kit/bin/review-kit.mjs backlog verify BL-0NN --method code --result passed --notes "<確認内容>"`。最後の検証と同時に移すなら `--status verified` を付ける(要求を満たさなければ検証の記録ごと失敗する)。
2. `--method manual` の必須項目は `reference.md`。`manual` / `both` の項目は、テスト・ビルド・コード確認では `verified` にしない。

### 仕上げ

1. `node node_modules/review-kit/bin/review-kit.mjs backlog validate --report`。`report is stale` のときだけ `node node_modules/review-kit/bin/review-kit.mjs backlog report` で再生成する。

## Completion criteria

- `validate --report` が `validated <件数> finding(s) and report` を出力して終了する。
- 追加・更新した ID が、CLI の出力どおりの `category` / `priority` / `status` になっている(確かめるなら `list --open` か `show --fields`)。
- `git status --short` の変更が `docs/backlog/findings.jsonl` と `docs/backlog/report.md`(証跡を残した場合は `docs/backlog/evidence/` の指定ファイル)に限られる。

## Do not

- `findings.jsonl` と `report.md` を直接編集しない。
- 実画面・実機確認が必要な項目を、テスト・ビルド・コード確認だけで `verified` にしない。
- 監査文書の内容を一括で 1 件へ詰め込まない。
- 類似検出が出たときに、提示された既存 ID を読まずに `--allow-similar` を付けない。
- `node_modules/review-kit` を書き換えない。仕組み自体の改善は review-kit リポジトリで行う。

## このリポジトリ固有の注意

- 運用ルールは `docs/backlog/README.md`、共通の運用ルールは `node_modules/review-kit/docs/operations.md`。
- `--app` の意味: `content` = 本家 `content.js` / `custom` = `extensions/custom/` / `helper` = 本家 `extensions/*.js` と iframe 注入 helper / `background` = `background.js` / `tests` / `docs` / `config` = manifest・package・verify・CI。
- `--verification-required` の `manual` / `both` は、ログイン済み X の実ブラウザーを見ないと判定できない項目にだけ付ける。Node テストと Playwright E2E(ローカル fixture)で判定できる項目は `code`。
- 元文書の例: `--source-document docs/code-audit-2026-09-18.md#R-11`。
- `content.js` の行番号は本家更新と分割で大きくずれる。着手時に `npm run backlog:update -- BL-0NN --evidence …` で取り直す。
- 本家ファイルの死コード削除・関数移動は `docs/upstream-port-log.md` にも残す。
- `docs/backlog.md` は索引であり、個別の残課題を書き足さない。
