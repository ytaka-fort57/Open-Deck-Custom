# Open-Deck Custom 検証手順

更新日: 2026-07-18

本家更新の移植、リファクタ、不具合修正後は、手作業の確認前に共通回帰テストを実行する。

## 高速なコード回帰

Node.jsの標準機能だけを使用する。npm installは不要。

```powershell
node tests/run.mjs
```

確認内容:

- 全JavaScriptの構文
- Chromium / Firefox manifestのJSONと参照ファイル
- 日本語 / 英語localeキー
- 設定codecの新旧形式、検証、export / import
- カラムタブ状態の保存直列化、プロファイル複製・削除、並び替え
- 文章校正の言語フォールバック、通信失敗、指摘範囲正規化
- 自動更新、プロファイル削除、observer、メディアtokenの回帰条件

## Windowsでの必須検証

回帰テストに加え、Chromium / Firefox ZIPを作成して許可リストを検査する。

```powershell
.\verify.ps1
```

出力ZIPは`package/`へ作成される。開発用ディレクトリ、文書、置換前のFirefox manifestが入っていないことも自動確認する。

## Linux / GitHub Actionsでの必須検証

Node.js、`zip`、`unzip`が必要。

```bash
chmod +x package.sh verify.sh
./verify.sh
```

Release workflowも同じ`verify.sh`を実行するため、ローカルとCIで検証条件が分岐しない。

## 実ブラウザーで残る確認

自動テストはXの現行DOMやログイン状態を再現しない。次は別途確認する。

- ログイン済みChromiumでの起動、追加、削除、並び替え、プロファイル切り替え
- メディアビューアーの画像・動画・引用投稿
- 文章校正APIの実通信
- Firefox Manifest V2での主要操作
