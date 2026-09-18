---
name: backlog
description: 残課題(リファクタ候補・不具合・実機確認待ち・保留機能)を docs/backlog/findings.jsonl へ登録し、状態を進め、検証結果を記録する。監査結果の掲載、対応状況の更新、検証済みへの移行、report の再生成を依頼されたときに使う。
---

# Backlog

## Overview

残課題の正本は `docs/backlog/findings.jsonl`、人が読む一覧は `docs/backlog/report.md`。
どちらも `scripts/backlog.mjs`(`npm run backlog:*`)経由で更新し、直接編集しない。
フィールドの定義は `docs/backlog/schema.md`、運用ルールは `docs/backlog/README.md`。
`docs/backlog.md` は索引であり、個別の残課題を書き足さない。

## Preconditions

- `git status --short` で `docs/backlog/` に未コミットの変更がないか確認する。あれば、それが今回の作業の前提か別作業かを判断してから進める。
- `docs/backlog/findings.jsonl.lock` が残っている場合は、保持プロセスを確認してから解除する。確認せずに消さない。
- 既存項目と重複しないか `npm run backlog:list` で確認する。同じ責務・利用者影響なら新規追加ではなく既存 ID を更新する。

## Workflow

### 追加する

1. 発見事項を**責務・利用者影響ごとに**分ける。監査結果をまとめて 1 件に詰め込まない。
2. `evidence` を先に確定する。`type=code` はリポジトリルート相対の `file:lines` で、絶対パス・UNC・`..` を使わない。空配列は登録できない。
3. `npm run backlog:add -- --category <系統> --app <対象> --area <領域> --priority <P1|P2|P3> --title … --finding … --impact … --proposal … --evidence <path:lines> --verification-required <code|manual|both>` を実行する。
   - `--category` は作業系統(`architecture` / `uiux` / `persistence` / `release` / `validation` / `security` / `performance` / `feature` / `i18n`)。
   - `--app` は対象(`content` = 本家 content.js / `custom` = extensions/custom / `helper` = 本家 extensions と注入 helper / `background` / `tests` / `docs` / `config`)。
   - `--evidence` `--acceptance-criteria` `--step` `--commit` `--tag` `--work-note` は複数回指定できる。
   - 元文書があれば `--source-document docs/code-audit-2026-09-18.md#R-11` の形で渡す。
4. `--verification-required` は、ログイン済み X の実ブラウザーを見ないと判定できない項目にだけ `manual` または `both` を選ぶ。Node テスト・Playwright E2E で判定できる項目は `code`。
5. PowerShell で日本語と長文を渡すと引用が壊れやすい。複数件をまとめて登録するときは、argv 配列を並べた `.mjs` スクリプトから `main()` を呼ぶ(スクリプトはスクラッチ領域に置き、リポジトリへ残さない)。

### 状態を進める

1. `discovered → triaged → in-progress → verified` の順に進める。初期登録時点で着手済みの項目に限り `discovered → in-progress` を許可する。
2. `npm run backlog:update -- BL-0NN --status <状態> --work-note "<条件と対応>"` で更新する。`in-progress` には `workNotes` か `relatedCommits` が要る。
3. 異常系を通常時に再現できない項目は、`in-progress` から `monitoring` へ移す。異常が起きたら `in-progress` へ戻し、再現手順と実機の検証を記録する。
4. `wont-fix` にする場合は `--reason` を渡す。

### 検証を記録する

1. `npm run backlog:verify -- BL-0NN --method code --result passed --notes "<確認内容>"`。
2. `--method manual` では `--screen` `--viewport` `--step`(1 つ以上)`--observed` が必須。スクリーンショットを残すなら `--screenshot docs/backlog/evidence/<name>.png`。
3. `verificationRequired` が要求する方法をすべて `passed` にしてから `--status verified` へ移す。

### 仕上げ

1. `npm run backlog:report` で `report.md` を再生成する。
2. `npm run backlog:validate -- --report` を実行する。
3. `node tests/run.mjs` が `tests/backlog.test.mjs` で同じ整合検査を行う。

## Completion criteria

- `npm run backlog:validate -- --report` が `validated <件数> finding(s) and report` を出力して終了する。
- 追加・更新した ID が `npm run backlog:list` に意図した `category` / `priority` / `status` で並ぶ。
- `git status --short` の変更が `docs/backlog/findings.jsonl` と `docs/backlog/report.md`(証跡を残した場合は `docs/backlog/evidence/` の指定ファイル)に限られる。

## Failure handling

- `similar finding exists: BL-0NN …` — 既存項目と責務が同じなら追加を中止し、その ID を `backlog:update` で更新する。別なら `--allow-similar` を付けて追加し、何が違うかを `finding` に書く。同じファイルを根拠にしただけの検出もあるため、提示された ID を必ず読んでから判断する。
- `invalid status transition: X -> Y` — 途中の状態を飛ばしている。`schema.md` の状態別の条件を満たしてから 1 段ずつ進める。
- `verified` へ移せない — `verificationRequired` が要求する方法の `verification` が `passed` で揃っていない。`manual` が必要な項目は Node テストや E2E では代替しない。
- `report is stale: run npm run backlog:report` — `report.md` が古い。再生成してから再度 validate する。
- ロックエラー — 保持プロセスを確認する。別の実行が進行中なら終了を待つ。

## Do not

- `findings.jsonl` と `report.md` を直接編集しない。
- 実機確認が必要な項目を、Node テスト・E2E・コード確認だけで `verified` にしない。
- 監査文書の内容を一括で 1 件へ詰め込まない。
- 類似検出が出たときに、提示された既存 ID を読まずに `--allow-similar` を付けない。
- `docs/backlog.md` に個別の残課題を書き足さない。
