# Open-Deck Custom 検証手順

更新日: 2026-08-25

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
- ブロックスコープ外呼び出し(`tests/scope_lint.mjs`)

## スコープ規約(ReferenceError再発防止)

`Uncaught ReferenceError: start_auto_reload is not defined`は、`if`ブロックの内側で
`const`宣言した関数を、別の`if`ブロックのイベントハンドラーから呼んでいたために発生した。
`node --check`は構文だけを見るため、この種の誤りは検出できない。

規約:

- 複数のイベントハンドラーから呼ぶ関数は、条件分岐の内側ではなく、
  そのハンドラー直下(関数スコープの先頭)で宣言する。
- 状態(interval ID等)も同じスコープに置き、開始・停止・破棄を1組で持つ。
- `content.js`のように巨大な関数では、要素取得と関数宣言を先頭に集約し、
  条件分岐は「登録するかどうか」だけを判断する。

`tests/scope_lint.test.mjs`が、ブロック内で宣言した関数のブロック外呼び出しを
プロジェクト全体で検査する。追加パッケージは不要。

## カラム内の戻る規約(joint session history)

各カラムは同一オリジンのiframeで、`history.back()` はフレームではなく全フレーム共通の
joint session historyを1つ戻す。戻る対象は「押したカラム」ではなく「直近に遷移した
フレーム」になるため、カラム分離は独自履歴(`extensions/custom/column_history.js`)が担う。

規約:

- `column_history.back()` に**現在の `history.state` を渡さない**。Xのルーターはstateの
  keyで描画エントリを決めるため、同じstateを渡すと再描画されずURLだけが変わる。
  渡すのは戻り先を記録した時点のstate、無い場合は `null`。
- スタックの要素は `{url, route_state}` である。URL文字列として比較・検索しない。
- `auto_reload_helper.js` の `scrollIntoView` / `focus` パッチから標準動作への委譲を
  増やさない。委譲するとXの復元処理がタイムラインを先頭までスクロールさせる。
  このヘルパーは自動更新の設定と無関係に home / explore の全カラムへ注入される。
- X標準のapp-bar戻るボタンをフックし直さない。カラム分離はBackspaceだけが担当する。

経緯と機序は[issue-column-back-navigation.md](issue-column-back-navigation.md)を参照。
`tests/column_history.test.mjs`と`tests/content_regression.test.mjs`が上記を固定する。

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
- Backspaceでの戻る(リプライ詳細→本体、リプライ→リプライ)と、戻った後のスクロール位置
- メディアビューアーの画像・動画・引用投稿
- 文章校正APIの実通信
- Firefox Manifest V2での主要操作
