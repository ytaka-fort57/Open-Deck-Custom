# 行末形式の固定と検査

## 目的

Open-Deck 本家由来のファイルは、ファイルごとに LF と CRLF が異なる。
そのため、リポジトリ全体を一律に LF または CRLF へ変換せず、意図しない行末変換だけを確実に検出する。

`.gitattributes` は `* -text`、`core.autocrlf` は `false` で、Git 自身による自動変換は無効になっている。
残る問題は、エディタ・パッチ適用ツール・テキスト処理スクリプトがファイルを書き戻す際の変換である。
これを、正本テーブルとのバイト比較で検査する。

## 構成

| ファイル | 役割 |
| --- | --- |
| `eol-policy.json` | 正本。どのファイルがどの行末・末尾改行かを機械可読で持つ |
| `scripts/check-line-endings.mjs` | バイト単位の検査・修正・正本更新・`.editorconfig` 生成 |
| `.editorconfig` | `eol-policy.json` から生成。エディタ側の予防 |
| `.githooks/pre-commit` | コミット予定の内容を検査 |
| `.github/workflows/line-endings.yml` | CI で同じ検査を実行 |
| `tests/line_endings.test.mjs` | 検査ロジックと正本の回帰テスト |

期待値は次の順で決まる。先に一致したものが優先される。

1. `files` の完全一致エントリ
2. `conventions` の glob (複数一致した場合は後勝ち)
3. `default` (LF・末尾改行あり)

「変更前のバイト」を期待値にはしない。それをすると既にコミットされている形式が
常に正しいことになり、意図した正規化を検査が永久に拒む。本家取り込みで増えた
未登録ファイルは既定と違えば報告されるが、それは正本へ登録すべきものである。

## 正規化の判断記録

`manifest.json` に1箇所だけ存在した LF は、本家由来ではなく当方の編集で混入したものだった。
upstream-base (`aae4fdb`) の `manifest.json` は CRLF 62 本・混在なしで、混在は当方の変更行にのみ現れていた。
したがって方針書の選択肢のうち **本家とのバイト互換を優先** を採り、CRLF へ戻して固定した。

`tests/keyboard_shortcuts.test.mjs` は独自ファイルでありながら唯一 CRLF だった。
本家由来ではなく取り込み衝突のリスクがないため、独自ファイルの標準である LF へ揃えた。

どちらも機能変更を含まない専用コミットで実施している。

## 正本テーブル

`eol-policy.json` が常に正であり、以下は読み方の説明にすぎない。

| 対象 | 行末 | 末尾改行 | 備考 |
| --- | --- | --- | --- |
| `manifest.json` | CRLF | なし | 本家由来 |
| `manifest_firefox.json` | LF | なし | 本家由来。`manifest.json` と同じ形式へ機械変換しない |
| `content.js` | CRLF | あり | 本家由来 |
| `package.ps1` | LF | あり | 本家由来。既定と同じなのでエントリを持たない |
| `extensions/**` | LF | なし | 本家由来の拡張スクリプト |
| `extensions/custom/**` | LF | あり | 独自ファイルの標準 |
| 上記以外 | LF | あり | `default` |

## 検査内容

対象は追跡中のテキストファイル、および staged 差分の追加 (`A`) / 変更 (`M`) / 改名 (`R`) である。
空ファイルと、NUL バイトを含むバイナリは検査しない。

1. 行末が正本の CRLF / LF と一致する
2. CRLF と LF が混在していない
3. CR 単独の改行がない
4. 末尾改行の有無が一致する

不一致時は、ファイル名・問題内容・正本の値・その正本がどこ由来か・修正方法を表示する。

## 日常の操作

```bash
npm run eol:check   # 追跡中の全ファイルを検査
npm run eol:fix     # 正本の形式へ書き戻す
npm run eol:sync    # .editorconfig を eol-policy.json から再生成
```

フックの有効化はクローンごとに一度だけ必要。

```bash
git config core.hooksPath .githooks
```

`npm run eol:check` は `tests/run.mjs` からも実行されるため、`verify.ps1` / `verify.sh` でも検査される。

## 本家の変更を取り込んだとき

新しく増えた本家ファイルが LF・末尾改行ありでなければ、正本へ登録する。

```bash
npm run eol:adopt -- <path>   # 実測値を eol-policy.json へ記録
npm run eol:sync              # .editorconfig を再生成
```

`--adopt` は、既定や `conventions` で説明できる形式のファイルにはエントリを作らず、
既存エントリが不要になった場合は削除する。テーブルは差分だけを保つ。
実測値が混在または CR 単独を含む場合は登録を拒否するため、先に原因を調べる。

引数なしの `npm run eol:adopt` は追跡中の全ファイルを実測値で上書きする。
意図しない変換を正本として固定してしまうため、移行時以外は使わない。

## 意図して正規化するとき

正本そのものを変える変更 (本家に合わせ直す、独自ファイルの標準へ揃える) は、
機能変更と混ぜず専用コミットで行う。手順は次のとおり。

1. `eol-policy.json` を先に直す (正本を変える場合)
2. `npm run eol:fix` で作業ツリーを揃える
3. `npm run eol:sync` で `.editorconfig` を再生成する
4. `git diff --ignore-cr-at-eol` が空であること、つまり行末以外が変わっていないことを確認する
5. 判断の根拠をコミットメッセージに残す

## 禁止事項

- `git commit --no-verify` で恒常的に回避する
- リポジトリ全体へ `git add --renormalize .` を実行する
- `manifest.json` と `manifest_firefox.json` を同じ行末へ機械変換する
- `.editorconfig` を直接編集する (`eol-policy.json` を直してから `npm run eol:sync`)
- 行末変換だけの大量差分を機能変更と同じコミットへ混ぜる
