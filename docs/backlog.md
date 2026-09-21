# カスタム版の残課題

更新日: 2026-09-18

対応済みの経緯は [issue-column-timeline-restore.md](archive/issue-column-timeline-restore.md) を参照。
運用手順は [open-deck-fork-project-setup.md](open-deck-fork-project-setup.md) が正。
最新監査は [code-audit-2026-09-18.md](code-audit-2026-09-18.md) を参照。
リファクタ候補の定義は [code-audit-2026-09-18.md](code-audit-2026-09-18.md)
(R-1〜R-10は [archive/code-audit-2026-09-11.md](archive/code-audit-2026-09-11.md))、
着手状況は [backlog/report.md](backlog/report.md) が正。
カラム内の戻るの機序と規約は [issue-column-back-navigation.md](issue-column-back-navigation.md) を参照。
実DOM E2E基盤の方針は [browser-e2e-test-design.md](browser-e2e-test-design.md) を参照。

実運用・手動確認の対象ブラウザーは Microsoft Edge（Chromium）とする。Firefox は使用予定がないため、
Firefox Manifest V2 の実機操作は対象外とし、既存の manifest / ZIP 構造検査だけを継続する。

## リファクタ進捗（2026-09-18）

- R-8の第一段階として、カラム設定DOMのfixtureと4種類のカラム設定テストを追加した。
- R-2の第一段階として、`extensions/custom/column_settings.js`へDOM読み取りと新規カラムの
  template値を集約した。第二段階として正規化モデル、renderer、設定値のround-tripを追加し、
  初期描画と4種類のカラム追加処理を共通化した。
- R-8の第二段階として、カラム再構築時の直接・入れ子iframe資源破棄と、新しいiframeの独立した
  資源registryをDOM fixtureで検証した。
- R-8の第三段階として、追加対象の選択、DOM挿入とreorder委譲、resource dispose前の削除、iframe
  load監視を`extensions/custom/column_dom.js`へ切り出し、ローカル回帰テスト71/71成功を確認した。
- R-2の第三段階として、settings codecの旧形式正規化、未知項目保持、`column_settings`との
  import/export round-trip境界を検証した。
- R-2/R-8の次段階として、初期プロファイルのラック分割・HTML生成と、表示順に沿った設定読み取りを
  `column_settings`へ集約した。4種類のカラム追加も`column_dom.add_column`へ共通化し、生成・追加・
  並び替え委譲・保存・再生成の境界をNode fixtureで検証した。ローカル回帰テストは74/74成功した。
- R-8/R-2のブラウザーE2E基盤をPlaywright同梱Chromiumで実装した。実X通信と個人profileを使わず、
  request routingした`x.com` fixture上で`content.js`全体を実行し、初期化、通知カラム追加、
  `style.order`並び替え、削除、保存・再構築round-trip、iframe実行context保持を検証する。
  E2Eで検出したサイドバーのprofile混入と、独自並び替え後に保存されない不整合も修正した。
- E2EのPhase 4として、cross-rack移動、プロファイル切替、戻る / Backspace、タブ復元、
  引用メディア選択の5シナリオを追加した。タブ保存の位置がDOM順で数えられていた不具合を
  検出して修正した（`extensions/custom/index.js`）。並び替え後に別カラムのタブ保存を
  奪っていた。Phase 3のCI導入は安定を確認してから行う。
- 実ブラウザーのログイン済みXでの操作確認は、従来どおり未実施。

## 残課題の管理

個別の残課題は [backlog/findings.jsonl](backlog/findings.jsonl) を正本とし、
[backlog/report.md](backlog/report.md) で一覧する(`npm run backlog:list` / `npm run backlog:report`)。
運用は [backlog/README.md](backlog/README.md)、項目定義は [backlog/schema.md](backlog/schema.md)。
このファイルには個別の残課題を書き足さない。

2026-09-18 に、ここにあった残課題 1〜9 と監査 R-1〜R-24 の未着手分を BL-001〜BL-030 として移行した。
実機確認待ち(引用付きメディア、カラム内の戻る)は `verificationRequired: manual` の項目として残っている。

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
- Xの戻るボタンとBackspaceを独自履歴へ置き換え、履歴が無くてもブラウザ戻るに落とさない
- タブ復元の遷移を `location.replace` にし、回数制限を iframe の load をまたいで保持する
- 擬似popstateでXが再描画しない場合は、戻り先URLを実際に読み込んで確実に戻す
- 動画variantを配列順に依存せず、HTTPSのMP4から最高bitrateを選択
- column共通disposerを追加し、文章校正observerとイベントを破棄
- 自動更新の開始・停止関数をハンドラー直下へ移し、`start_auto_reload is not defined`を解消
- ブロックスコープ外呼び出しの静的検査(`tests/scope_lint.mjs`)と規約を追加
- 更新関数をReactの現在の描画から毎回取り直し、遷移後に更新が走らない問題を解消
- カラムごとの手動更新ボタンを追加
- 戻る先のrouter stateを復元し、リプライ詳細から本体へ戻れない問題を解消
- `auto_reload_helper`のスクロール抑止を戻し、戻った後の先頭スクロールを抑止
- 戻るの成否を描画の変化で判定し、失敗時はURLを戻して履歴を保つよう変更
- タブ復元の自動遷移を1カラム1回までに制限し、joint session historyの奪取を抑止（のち load 跨ぎと replace へ強化）
- カラム移動でiframeが切断された後も履歴追跡を再開するよう変更

## 運用判断済み

- 本家更新の頻度が低い間は、fork側の構造を優先し、必要な変更だけを意味単位で再実装する。
- プロファイル自動復旧の本家PRは現時点では作成しない。小さな純粋修正を本家へ戻す効果が明確になった場合だけ再検討する。

## リファクタ方針

本家更新は意味移植するため、競合回避だけを理由に有益なリファクタを止めない。ただし、一度に全面置換せず、検証できる責務単位で分割する。

- 不具合へ直結する処理だけを小さく修正する
- 新しい独自処理は可能な限り`extensions/custom/`へ置く
- 本家差分を読む際に変更意図を追えるよう、責務とテストの対応を明確にする
- 検証コードは`tests/`などの新規領域へ追加し、本家ファイルとの競合を避ける

2026-09-11の監査では、`content.js`の責務集中、設定のDOM変換重複、履歴・lifecycleの境界、
MutationObserverの全体走査を主な候補として整理した(R-1〜R-10)。2026-09-18の再監査で、
iframe内CSS適用の三重複、`load`リスナーと保存リスナーの蓄積、死コード、i18n取りこぼし、
デッキCSSの分離などをR-11〜R-24として追加した。優先度と分割順は
[code-audit-2026-09-18.md](code-audit-2026-09-18.md)を正とする。

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
