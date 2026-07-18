# カスタム版の残課題

更新日: 2026-07-18

対応済みの経緯は [issue-column-timeline-restore.md](issue-column-timeline-restore.md) を参照。
運用手順は [open-deck-fork-project-setup.md](open-deck-fork-project-setup.md) が正。

## 優先度: 高

### 1. 本家への Pull Request を検討する

プロファイル自動復旧の不具合（`window.reload()` の誤りと `return` 漏れ）は本家にも存在する。
修正は `b54246d` で取り込み済み。本家 kawa-nobu/Open-Deck へ提案するか判断する。

独自機能ではなく純粋な不具合修正のため、受け入れられれば以後の差分が減る。

### 2. カラムごとの「戻る」が別のカラムに効く

ブラウザーの戻る操作は、フレームをまたいだ joint session history を対象とするため、
「最後に遷移したカラム」が戻る。実ブラウザーで検証済みで、フレームを指定して戻る手段は無い。
X のカラム内の戻るボタンも内部で同じ経路を使うため、別のカラムが動く。

Backspace は独自の URL 履歴で戻すため正しく動く（`69cb846`）。
X の戻るボタンも同じ仕組みに乗せ換えれば直せるが、ボタンの特定に X の DOM 情報が必要。
現状は Backspace を使う運用で回避している。

## 優先度: 中

### 3. Firefox（Manifest V2）未検証

マニフェストには独自コードを登録済みだが、動作確認をしていない。

### 4. 本家レビューworkflowの初回動作確認

`.github/workflows/sync-upstream.yml`は直接mergeせず、`.github/upstream-base`以降の差分をGitHub Issueへまとめる方式に変更済み。GitHub上で手動dispatchし、更新なしではIssueを作らず、更新ありでは同じレビューIssueを作成・更新することをまだ確認していない。

### 5. 動画variantの選択

表示・ダウンロードとも配列末尾のvariantを使っている。実際のXのpayloadで、MP4候補、HLS候補、bitrate、配列順を確認してから選択規則を決める。

## 対応済み

- カラム並べ替え・追加・削除・プロファイル操作時のタブ状態再配置
- メディアトークンをiframeごとの`WeakMap`へ変更し、再読込・削除後の古いtokenを保持しないよう修正
- 設定import/exportのスキーマ化、検証、一括保存
- 配布ZIPの許可リスト化とRelease CIでの混入検査
- ページ単位のlistener、observer、自動更新破棄、メディアtokenを`lifecycle.js`へ分離
- storageキー、JSON変換、書き込み直列化を`storage_repository.js`へ統合
- Node標準テスト16件とWindows / Bashの単一検証コマンド
- 本家の直接mergeを廃止し、週次レビューと意味移植の運用へ変更

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
