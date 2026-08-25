# カスタム版の残課題

更新日: 2026-08-25

対応済みの経緯は [issue-column-timeline-restore.md](archive/issue-column-timeline-restore.md) を参照。
運用手順は [open-deck-fork-project-setup.md](open-deck-fork-project-setup.md) が正。
最新監査は [code-audit-2026-08-11.md](code-audit-2026-08-11.md) を参照。
カラム内の戻るの機序と規約は [issue-column-back-navigation.md](issue-column-back-navigation.md) を参照。

## 優先度: 中

### 1. 引用付きメディアの選択境界

引用コンテナを特定できた場合に引用側のメディア情報を優先するコード修正と回帰テストを追加済み。Xの現行DOMとReact propsを使った実ブラウザーfixtureで、引用元・引用先の選択結果を確認する。

### 2. `misskey` / `bsky`カラム対応（保留）

現行deckには描画templateがなく利用予定もないため、`settings_codec`だけで受理する変更は行わない。必要になった時点で、描画・保存・import・移行testをまとめて実装する。

### 3. タイムラインのリアルタイム流し込み（X Pro相当）

現在の自動更新は、Xの内部更新関数(`onRefresh`)を周期的に呼ぶ方式で、TweetDeck / X Proのように
新着が上から流れ続ける挙動ではない。実現するには、カラムiframe内のGraphQL応答または新着通知の購読を
監視し、差分を先頭へ挿入する仕組みが要る。周期更新の安定化を優先し、ここでは見送る。

### 3.5 カラム内の戻るの残り弱点

戻れない原因(router stateの取り違え)と先頭スクロール(スクロール抑止の委譲)は修正済み。
先頭スクロールは発生条件が不定のため、実機での解消をまだ確定できていない。あわせて次の
3点が残る。詳細は [issue-column-back-navigation.md](issue-column-back-navigation.md)。

- `back()` の成否判定が、自分で `replaceState` したURLとの一致を見ているため常に成功扱い
- `enforce_tab` の自動タブクリックが、ピン留めリストのタブでjoint session historyを奪う
- ラックをまたぐカラム移動でiframeが切断されると `track()` が再登録されない

## 優先度: 低

### 4. 本家レビューworkflowの初回動作確認

`.github/workflows/sync-upstream.yml`は直接mergeせず、`.github/upstream-base`以降の差分をGitHub Issueへまとめる方式に変更済み。GitHub上で手動dispatchし、更新なしではIssueを作らず、更新ありでは同じレビューIssueを作成・更新することをまだ確認していない。

### 5. Firefox（Manifest V2）実機未検証

マニフェストには独自コードを登録済みだが、現時点で使用予定がないため優先度を下げる。

### 6. `content.js`のDOM実行テスト拡大

安全値、background sender、storageは実行テスト化済み。残る巨大なDOM処理は、責務を純粋関数・controllerへ分離するタイミングで文字列検査から置き換える。

### 7. ハッシュタグ保存先の分離

文章校正ヘルパーのハッシュタグはXページの`localStorage`へ保存される。Open-Deckのプロファイル単位で保持・削除する必要が生じた場合は、共有storage repositoryとの境界を設計する。

### 8. リストフィルタの監視負荷計測

リスト候補のiframeごとにMutationObserverと1秒周期のURL確認を動かし、更新のたびに投稿全体を走査する。大量フィードで負荷が確認された場合に、対象領域・イベント・差分走査を見直す。

### 9. タブ状態を位置キーから安定IDへ移行（設計保留）

現在の追加・削除・並べ替え・プロファイル操作は位置の再配置で保護済み。安定ID化は全プロファイルの移行と旧データ互換を伴うため、実ブラウザーfixtureを整える段階まで保留する。

## 対応済み

- カラム並べ替え・追加・削除・プロファイル操作時のタブ状態再配置
- メディアトークンをiframeごとの`WeakMap`へ変更し、再読込・削除後の古いtokenを保持しないよう修正
- 設定import/exportのスキーマ化、検証、一括保存
- 配布ZIPの許可リスト化とRelease CIでの混入検査
- ページ単位のlistener、observer、自動更新破棄、メディアtokenを`lifecycle.js`へ分離
- storageキー、JSON変換、書き込み直列化を`storage_repository.js`へ統合
- Node標準テスト33件とWindows / Bashの単一検証コマンド
- 本家の直接mergeを廃止し、週次レビューと意味移植の運用へ変更
- 属性値escape、同一オリジンpath検証、メディアURLのDOM安全化
- 自動更新周期の再作成、cross-origin iframe監視の例外防止
- background sender検証、FileReader失敗表示、storage mutator返り値検証
- Xの戻るボタンは標準ルーターへ返し、カラム分離はBackspaceの独自履歴だけが担当
- 動画variantを配列順に依存せず、HTTPSのMP4から最高bitrateを選択
- column共通disposerを追加し、文章校正observerとイベントを破棄
- 自動更新の開始・停止関数をハンドラー直下へ移し、`start_auto_reload is not defined`を解消
- ブロックスコープ外呼び出しの静的検査(`tests/scope_lint.mjs`)と規約を追加
- 更新関数をReactの現在の描画から毎回取り直し、遷移後に更新が走らない問題を解消
- カラムごとの手動更新ボタンを追加
- 戻る先のrouter stateを復元し、リプライ詳細から本体へ戻れない問題を解消
- `auto_reload_helper`のスクロール抑止を戻し、戻った後の先頭スクロールを抑止

## 運用判断済み

- 本家更新の頻度が低い間は、fork側の構造を優先し、必要な変更だけを意味単位で再実装する。
- プロファイル自動復旧の本家PRは現時点では作成しない。小さな純粋修正を本家へ戻す効果が明確になった場合だけ再検討する。

## リファクタ方針

本家更新は意味移植するため、競合回避だけを理由に有益なリファクタを止めない。ただし、一度に全面置換せず、検証できる責務単位で分割する。

- 不具合へ直結する処理だけを小さく修正する
- 新しい独自処理は可能な限り`extensions/custom/`へ置く
- 本家差分を読む際に変更意図を追えるよう、責務とテストの対応を明確にする
- 検証コードは`tests/`などの新規領域へ追加し、本家ファイルとの競合を避ける

## 既知の制約（対応しない）

- 「おすすめ」と「フォロー中」を別々のカラムに同時表示することはできない。
  X がこの2つに固有の URL を持たず、タブ選択をアカウント単位で共有しているため。
  リストは `/i/lists/<id>` の URL を持つため、Explore カラムとして開けば独立して復元できる。

## 注意

- 改行コードは本家に合わせる（[.gitattributes](../.gitattributes) 参照）。
  本家はファイルごとに改行コードが異なるため、LF に統一してはいけない。
  統一すると本家との差分レビューが改行変更に埋まり、本家へ純粋な不具合修正を提案しにくくなる。
- 改行コードの変換は pre-commit フックが検知して止める。クローンごとに一度だけ有効化が必要:

  ```
  git config core.hooksPath .githooks
  ```

- Git Bash の `grep` は CR を数えられない（CRLF のファイルに 0 を返す）。
  改行コードを調べるときは `git diff --ignore-cr-at-eol` か Python を使う。
- 別の拡張機能（`xsc:composer`）が同じ x.com に注入されている。
  DOM を触るため、原因不明の挙動が出たら切り分け対象にする。
