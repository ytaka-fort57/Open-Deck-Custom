---
name: backlog-fix
description: BL の発見事項(BL-0NN)の対応要否を確かめ、修正・テスト・台帳記録・custom への取り込み・worktree とブランチの後片付けまでを1続きで行う。「BL-0NN を対応して」「BL-079〜081 を直して」のように番号を指定して対応を頼まれたときに使う。台帳の書き方は backlog、git の基本操作は git-flow に従う。
---

# BL の発見事項を対応して片付ける

台帳の操作は `backlog` スキル、ブランチ・コミット・マージの基本は `git-flow` スキルが正。
このスキルは、その2つを「要否確認 → 修正 → 記録 → 取り込み → 後片付け」の順につなぐ。

以下 `K` は `node node_modules/review-kit/bin/review-kit.mjs backlog`。

## 1. 着手前の確認

1. `K preflight` を実行する。`lock: held` なら止まる(`backlog` スキルの Preconditions)。
2. `git status --short` を確認する。指定された件と関係のない未コミット変更があれば、その一覧を控える。
   - 関係のない変更は、コミットもリセットもしない。
   - 台帳(`findings.jsonl` / `report.md`)に別件の変更が混ざっているときは、6 の台帳のコミットで扱いを決める。
3. 対象ごとに `K show BL-0NN --fields id,status,verificationRequired,finding,evidence,acceptanceCriteria,proposal` を読む。

## 2. 対応要否を判断する

対象ごとに、現行コードで指摘がまだ成り立つかを確かめる。

- 行番号はずれる(特に `content.js`)。関数名で探す。
- 成り立たない、またはすでに直っている場合:
  - 他の変更で直っているなら、その commit を根拠に `verify --method code` を記録して `verified` にする。
  - 対応しないと決めた場合は、`update --status wont-fix --reason "<根拠 file:行>"` にする(`triaged` を経由する)。
- 成り立つ場合: 根拠(`file:行` と経路)を控え、3 へ進む。

## 3. 修正する(1件 = 1ブランチ = 1隔離 worktree)

- 互いに独立した件は、サブエージェントを `isolation: "worktree"` で並列に起動してよい。プロンプトには次を必ず入れる。
  - finding・evidence・受入条件・提案(`show` の内容)
  - 起点は `custom`。ブランチ名は `fix/bl0NN-<要約>`
  - 最初に要否を判断し、不要なら修正せずに根拠を返す
  - 兄弟経路(同じ判断・保存・タイマーを持つ別経路)をリポジトリ全体で探す
  - テストは決定的に書く(実時間の sleep を使わない。制御できる Promise・偽タイマー・固定 ID を使う)
  - `node tests/run.mjs` を全件通す。行末を変えない(`git diff --stat` と `--ignore-cr-at-eol` の差なし)
  - 本家由来ファイル(`content.js`、`extensions/*.js`)は変更を最小にする。関数を移動・削除したら `docs/upstream-port-log.md` に 1 行追記する
  - `docs/backlog/` には触らない。push しない
  - 日本語でコミットする(`git-flow` の書式と、会話で指示された共著者行)
  - 報告には要否の根拠、変更内容、兄弟経路の調査結果、テスト名と件数、commit・ブランチ、実 X で人が確認する手順(`manual` / `both` の件だけ)を含める
- worktree に `node_modules` がなければ `npm ci --ignore-scripts` を実行する。review-kit を使うテストが落ちるため。
- 戻ってきた差分は自分で読む。保存エラーを判定する関数の戻り値など、前提にしている既存 API が実際にそう動くかを確かめる。

## 4. 取り込む前の統合テスト

1. 先にできたブランチの上へ、ほかのブランチを順に rebase して 1 列に並べる。
   - `docs/upstream-port-log.md` の追記は衝突しやすい。両方の行を残して解消する。
2. 先頭のブランチで、次の 3 つを実行する。
   - `node tests/run.mjs`
   - `npx playwright test`
   - `npm run eol:check`
3. 2 の 3 つがすべて通ったら、`git merge --ff-only <先頭ブランチ>` で custom を進める。
   - 手元の作業ツリーに関係のない変更があっても、取り込むファイルと重ならなければそのまま進められる。

## 5. 台帳へ記録する

`--input` の JSON(スクラッチ領域に置き、リポジトリに残さない)で、各段階を一括で更新する。毎回 `--dry-run` を先に通す。

1. `update`: `discovered → triaged`。workNote に要否判断の根拠を書く。
2. `update`: `triaged → in-progress`。`commit` に修正のコミット、workNote に対応内容・兄弟経路の調査結果・残るリスクを書く。
3. `verify --method code --result passed`。notes に追加したテスト名と、統合後のテスト件数(unit / e2e)を書く。
   - `verificationRequired: code` の件: `"status": "verified"` を付ける。
   - `manual` / `both` の件: `in-progress` のまま残す。実 X での確認手順を利用者に渡す(手動検証は人が `verify --method manual` で記録する)。
4. `K validate --report` を実行する。`validated N finding(s) and report` が出れば完了。
   - Windows で `EPERM: rename … findings.jsonl` が出たら、何も書かれていない。`show` で確かめてから同じ入力を流し直す。

## 6. 台帳のコミット

- 台帳の差分が今回の件だけなら、`docs: BL-0NN の対応と検証を台帳へ記録する` のような件名でコミットし、custom へ載せる。
- 別件の未コミット変更が台帳に混ざっていたら、台帳を件ごとに分けない。
  - `findings.jsonl` を直接書き換えて分けることは禁止されている(権限の判定でも拒否される)。`report.md` は全体から生成される。
  - 利用者に確認したうえで、別件のコード(workflow・テストなど)を先にコミットする。そのあと、台帳を 1 つのコミットにまとめ、件名と本文に両方の件を書く。

## 7. 後片付け

1. `git worktree list` を確認し、今回作った隔離 worktree を `git worktree remove <path>` で消す。
   - 未コミットの変更が残っていれば消さない。`node_modules` は追跡外なので、消してよい。
2. 一時ブランチ(`worktree-agent-*`)と、custom に取り込み済みの `fix/bl0NN-*` を `git branch -d` で消す。
   - `-d` が拒否する(取り込まれていない)ブランチは消さず、報告する。
3. push(`git push origin custom`)は外部に公開する操作なので、利用者の指示があるときだけ行う。
4. 最後に次を確かめる。
   - `K preflight` で、ロックがないこと。
   - `git status --short` に、着手前に控えた変更と今回の台帳以外が残っていないこと。

## 完了時の報告

- 各件の要否判断・対応内容・状態(`verified` / `in-progress`)
- custom に積んだコミットと、テスト件数(unit / e2e)
- 実 X で人が確認する手順(`manual` / `both` の件)
- 未コミット・未 push のもの、消さなかった worktree・ブランチと、その理由
