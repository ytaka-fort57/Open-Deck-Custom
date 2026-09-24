<!-- review-kit skills install で生成。直接編集しない。固有の注意は review/skill-notes/<スキルID>.md に書いて再生成する -->

# Backlog reference

同じディレクトリの `SKILL.md` から必要なときだけ読む詳細。コマンドはすべて `node node_modules/review-kit/bin/review-kit.mjs backlog <サブコマンド>`。

## JSON 入力(`--input <file|->`)

- 1 件のオブジェクトか、その配列。キーは CLI のオプション名(`verification-required`)か findings のフィールド名(`verificationRequired` / `acceptanceCriteria` / `tags` / `relatedCommits`)。
- 複数回指定できる項目(`evidence` / `acceptanceCriteria` / `tags` / `commit` / `steps` / `untag`)は配列で渡す。
- `evidence` は `"file:lines"` 文字列か `{ "file": …, "lines": … }`。`sourceDocument` は `"file#section"` か `{ "file": …, "section": … }`。
- `add` の 1 件だけ類似検出を越えるなら、その件に `"allowSimilar": true` を入れ、何が違うかを `finding` に書く。
- `update` と `verify` は各件に `"id": "BL-0NN"` を入れる。`--input` と ID・項目のオプションは併用できない(`--dry-run` だけ使える)。
  - `update` の例: `[{ "id": "BL-001", "status": "triaged", "acceptanceCriteria": ["…"], "workNote": "…" }]`
  - `verify` の例: `[{ "id": "BL-001", "method": "code", "result": "passed", "notes": "…", "status": "verified" }]`
- stdin から渡すときは `--input -`。npm scripts 経由にしない(PowerShell の `npm.ps1` はパイプ入力時に `--` を落とす)。
- 失敗は全件分まとめて `input[N]: …` で返る。まとめて直してから流し直す。

## 引数で 1 件を登録する場合

`add --category <系統> --app <対象> --area <領域> --priority <P1|P2|P3> --title … --finding … --impact … --proposal … --evidence <path:lines> --verification-required <code|manual|both>`

- `--evidence` `--acceptance-criteria` `--commit` `--tag` は複数回指定できる。元文書があれば `--source-document docs/<文書>.md#<節>`。
- 日本語の長文はシェルの引用で崩れやすいため、JSON 入力を優先する。

## 手動検証

- `verify --method manual` では `--screen` `--viewport` `--step`(1 つ以上)`--observed` が必須。JSON では `screen` / `viewport` / `steps` / `observed`。
- スクリーンショットを残すなら `--screenshot docs/backlog/evidence/<name>.png`。
- `verificationRequired: both` の項目は、`code` と `manual` の両方を `passed` にしてから `verified` へ移す。
- `monitoring` の項目で異常が起きたら `in-progress` へ戻し、再現手順と実機の検証を記録する。

## 出力

- `show` / `list` は `--fields` で項目を絞れる。使える項目は findings の最上位フィールド(`id` / `status` / `title` / `finding` / `evidence` / `verification` / `workNotes` など)。
- PowerShell のパイプなど標準出力の文字コードが UTF-8 でない経路では `show --ascii`(非 ASCII を `\uXXXX` で出す。出力は長くなる)。

## Failure handling

- `similar finding exists: BL-0NN …` — 既存項目と責務・利用者影響が同じなら追加をやめ、その ID を `update` で更新する。別なら `allowSimilar` を付けて追加し、何が違うかを `finding` に書く。タイトルの語が重なった、同じファイルを根拠にしただけの検出もあるため、提示された ID を必ず読んでから判断する。
- `invalid status transition: X -> Y` — 途中の状態を飛ばしている。`node_modules/review-kit/docs/schema.md` の状態別の条件を満たしてから 1 段ずつ進める。
- `cannot be verified before required verification passes` — `verificationRequired` が要求する方法の検証が `passed` で揃っていない。`manual` が必要な項目は、テスト・ビルド・コード確認では代替しない。
- `needs acceptanceCriteria from triaged onward` / `needs workNotes or relatedCommits` — 状態に必要な項目を同じ `update` で渡す。
- `report is stale` — `report` で再生成してから、もう一度 `validate --report`。
- ロックエラー — `preflight` で保持プロセスを確認する。別の実行が進行中なら終了を待つ。
