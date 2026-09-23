# 残課題バックログの運用

正本は `findings.jsonl`、人が読む一覧は `report.md`。`report.md` は CLI で生成し、直接編集しない。
フィールド定義は [schema.md](schema.md)、エージェント向け手順は `.claude/skills/backlog/SKILL.md`(`npx review-kit skills install` で生成)。
仕組みは共通パッケージ [review-kit](https://github.com/ytaka-fort57/review-kit) で、本リポジトリの差分は
`review.config.json`(置き場所、ID 接頭辞 `BL-`、語彙、既定値)と `review/`(レンズ、自動修正方針、スキルの固有注意)にだけある。
仕組み自体の改善はこのリポジトリではなく review-kit で行う。

## 基本操作

```powershell
npm run backlog:add -- --category architecture --app content --area css --priority P1 --title "iframe内CSS適用が3か所に複製されている" --finding "…" --impact "…" --evidence "content.js:989-1048" --proposal "…" --verification-required code
npm run backlog:list -- --priority P1 --status triaged
npm run backlog:list -- --app content --unverified
npm run backlog:update -- BL-001 --status in-progress --work-note "対応方針を検討中"
npm run backlog:update -- BL-001 --status monitoring --work-note "実Xで異常が出たときに確認"
npm run backlog:verify -- BL-001 --method code --result passed --notes "node tests/run.mjs 75/75"
npm run backlog:verify -- BL-001 --method manual --result passed --screen "x.com デッキ" --viewport 1600x900 --step "拡張を読み込む" --step "カラムを追加する" --observed "iframe head に style が1本だけある"
npm run backlog:update -- BL-001 --status verified
npm run backlog:report
npm run backlog:validate -- --report
```

`--category` は作業系統、`--source-document docs/code-audit-2026-09-18.md#R-11` は元文書を指定する。
`--evidence`、`--acceptance-criteria`、`--step`、`--commit`、`--tag`、`--work-note` は複数回指定できる。タグを外すときは `--untag`。
類似項目が検出された場合は追加を止めて既存 ID を表示する。意図的に別項目として追加する場合だけ `--allow-similar` を付ける。

日本語の長文や複数件はシェルの引用を経由せず JSON で渡す。

```powershell
npm run backlog:add -- --input findings-draft.json --dry-run
npm run backlog:add -- --input findings-draft.json
Get-Content findings-draft.json -Raw | node node_modules/review-kit/bin/review-kit.mjs backlog add --input -
npm run backlog:show -- BL-001
npm run backlog:show -- BL-001 --ascii
```

stdin へパイプするときは `npm run` を経由しない。PowerShell の `npm.ps1` はパイプ入力があると `--` を落とし、
`--input` 以降を npm 自身のオプションとして消費する。

JSON は 1 件のオブジェクトかその配列で、キーは CLI のオプション名か findings のフィールド名(camelCase)を使う。
`evidence` は `"file:lines"` か `{ "file", "lines" }`、`sourceDocument` は `"file#section"` か `{ "file", "section" }`。
配列のうち 1 件でも失敗したら何も書き込まない。`--input` と項目のオプション(`--title` など)は併用できない。
`show` は 1 件の全フィールドを JSON で出す。`--ascii` は非 ASCII を `\uXXXX` で出し、標準出力の文字コードに左右されない。

`verified` へ変更するには、`verificationRequired` が要求する方法の検証をすべて `passed` で記録する必要がある。
ログイン済み X での実機確認が必要な項目(`manual` / `both`)は、Node テストや E2E の成功だけでは検証済みにならない。
E2E(Playwright + ローカル `x.com` fixture)は `code` 側の検証として記録する。

異常系を通常時に再現できない場合は `monitoring` として記録する。
実質終了として要対応・未確認一覧から外れるが `verified` とは別状態で、異常が起きたら `in-progress` へ戻す。

## 運用ルール

- `findings.jsonl` は CLI 経由で更新する
- ロックファイル(`findings.jsonl.lock`)が残っている場合は、保持プロセスを確認してから解除する
- `report.md` が古い場合は `npm run backlog:report` で再生成する
- `node tests/run.mjs`(`tests/review_contract.test.mjs`)が正本と `report.md` の整合と、生成スキルのずれを検査する。
  `verify.ps1` / `verify.sh` の前に `npm run backlog:validate -- --report` を通す
- 監査文書の内容を一括で 1 件へ詰め込まず、利用者影響・責務ごとに分ける
- 運用上の不整合を見つけたら、該当案件の `workNotes` に条件と対応を残し、仕組み側の再発条件は review-kit に回帰テストとして追加する
- 本家(`kawa-nobu/Open-Deck`)由来のファイルを直す項目は、`app: content` / `helper` を付け、
  削除・移動した箇所を [upstream-port-log.md](../upstream-port-log.md) に残す

### 根本対応と過剰対応の境界

- 優先度は利用者影響、再発可能性、破損時の範囲で決める。実装コストや所要時間を理由に
  優先度を下げない。規模が大きい場合は、優先度を維持したまま安全に検証できる単位へ分割する。
- 暫定修正で直近の影響だけを止めても、同じ原因が別経路に残る場合は完了扱いにしない。
  暫定修正と根本対応を分ける場合は、根本対応を既存findingの未完了条件または関連findingとして残す。
- `verified` にする前に、修正した関数名だけでなく、同じ判断、タイマー、observer、状態遷移、
  URL正規化などを持つ兄弟経路をリポジトリ全体で検索する。共通の設計制約がある場合は、
  その制約を破る新規実装を検出できる回帰テストまたは単一の実装境界を受入条件に含める。
- 根本対応は「将来あり得るすべて」を抽象化することではない。既存の共通境界を再利用する、
  または現在重複している判断を1か所へ集約する最小変更を優先する。
- 汎用framework、registry、plugin層の新設は、実運用コードに複数の利用箇所がある、同種の再発がある、
  または lifecycle・security・persistence の不変条件を一元管理する必要がある場合に限る。
  単一の利用箇所と仮想的な将来需要だけなら、局所修正と対象テストに留める。

## 現在の登録元

| 元文書 | 範囲 |
|---|---|
| [code-audit-2026-09-18.md](../code-audit-2026-09-18.md) | リファクタ候補 R-11〜R-24 と、未着手の R-1 / R-3〜R-7 / R-9 / R-10 |
| [backlog.md](../backlog.md)(2026-09-18 時点) | 残課題 1〜9(実機確認、保留機能、CI、Firefox、監視負荷、安定 ID) |

`backlog.md` は索引と「既知の制約」「注意」だけを残し、個別の残課題はこの仕組みで管理する。
