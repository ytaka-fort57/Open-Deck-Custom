# Open-Deck Custom リファクタ候補監査

監査日: 2026-09-11  
対象: 現行 `fix/column-back-cross-tab` 作業ツリー  
目的: アプリ内のリファクタ候補を整理し、着手順と検証方針を残す

## 結論

現時点で、ローカル回帰テストが失敗する高優先度の不具合は確認していない。一方で、
本家由来の大きな `content.js` と、カラム・履歴・ページライフサイクルの責務分散が、
今後の変更時に回帰を生みやすい。まず設定モデルとDOM実行テストを整え、その後に
`content.js`を責務単位で段階分割するのが適切である。

この監査はコード構造の整理であり、ログイン済みX上の実動作を保証するものではない。
特にカラムのjoint session history、現在のX DOM、iframeの再読込は実ブラウザーで別途確認する。

## 2026-09-12の実装進捗

- R-8の第一段階として、カラム設定DOMのfixtureを追加し、post / home / notification / exploreの
  読み取りと新規追加時のplaceholder値を回帰テストで固定した。
- R-2の第一段階として、設定のDOM読み取りと4種類の新規カラム用template値を
  `extensions/custom/column_settings.js`へ集約した。classic scriptの順序はmanifestで固定し、
  保存形式と位置キーは変更していない。
- R-8の残り（カラム追加・削除・再構築・並び替え・iframe loadの直接実行fixture）と、
  R-2のHTML renderer自体の分離は次段階として残る。

## 検証結果

- `node tests/run.mjs`: 65/65 成功
- 全JavaScriptの構文、manifest、locale、安全値、storage、observer、履歴、リストフィルタの回帰検査: 成功
- 作業ツリーは未コミット変更を含む。今回の監査では既存変更を上書きしていない
- ログイン済みXの操作、Firefox Manifest V2の実機操作: 未実施

## リファクタ候補

| ID | 優先度 | 対象 | コード上の事実 | 推奨する分割・対応 |
| --- | --- | --- | --- | --- |
| R-1 | 高 | `content.js`のアプリシェル | `run()`が約1,800行あり、画面生成、CSS、プロフィール、カラム操作、保存、DnD、自動更新、observerを内包する | `bootstrap`、`deck_renderer`、`column_controller`、`profile_controller`へ段階分割する。既存のグローバルAPIとscript順は当面維持する |
| R-2 | 高 | 設定モデルとDOM変換 | 設定からHTMLを作る処理と、DOMから設定を保存する処理が離れており、4種類のカラム追加処理も同じplaceholder置換を重複している | `column_settings.js`へDOM読み取りとtemplate値を第一段階として集約済み。次に正規化、HTML renderer、設定のround-tripテストを追加する |
| R-3 | 高 | 履歴・戻るController | `index.js`、`keyboard_shortcuts.js`、`column_history.js`に、Backspace、app-bar戻る、メディア例外、Xへの遷移が分散している | 「入力中」「メディア」「履歴あり」「履歴なし」の判定表をテストで固定し、UIイベントと履歴状態機械を分離する |
| R-4 | 高 | ページlifecycle | `lifecycle.js`がカラム資源、自動更新、メディアtoken、ページイベント、observer、タイトル/faviconをまとめて管理する | `column_resource_registry`、`page_event_lifecycle`、`page_observer_lifecycle`へ分離する。各observerがdisposerを返す形に揃える |
| R-5 | 中 | DOM変更監視 | `custom/index.js`のMutationObserverが、DOM変更ごとにタブ、キー、リストフィルタ、並び替えの全体処理を呼ぶ | microtaskまたは短いdebounceで更新を集約し、追加・削除されたカラムだけを対象にする |
| R-6 | 中 | リストフィルタ | 投稿分類、全投稿走査、MutationObserver、URL確認、タイマー、破棄処理が1ファイルにある | 投稿分類器を純粋関数として残し、差分走査を行うcontrollerと分ける。大量フィードでCPU・Mutation回数を計測してから最適化する |
| R-7 | 中 | プロフィール操作 | プロフィール一覧HTMLの生成とイベント再接続が保存・追加・削除の複数箇所に重複している | `profile_controller`に一覧描画、切替、追加、削除、保存後の再接続を集約する |
| R-8 | 中 | 実DOMテスト | `content.js`の回帰検査は配線やソース文字列の検査が中心で、巨大なDOM初期化を直接実行していない | 設定境界のDOM fixtureを追加済み。次にカラム追加・削除・再構築・並び替え・iframe loadを実行検証し、分割作業の前提にする |
| R-9 | 低 | カラムの安定識別子 | タブ状態が`profile_index:column_index`をキーにしており、並び替え・削除時のremapが必要 | 全プロファイル移行、旧データ互換、失敗時rollbackを設計してからstable IDへ移行する。短期対応では現行remapを維持する |
| R-10 | 低 | 配布定義とデバッグコード | Chrome/Firefox manifestとpackageスクリプトに重複があり、`content.js`にはprototype/testmode/debug UIが同居する | 配布対象・content script一覧の生成元を一本化する。デバッグ機能は開発用scriptまたは明示的なbuild設定へ移す |

## 着手順

1. R-8の設定境界fixtureを追加済み。残るカラムライフサイクルのDOM fixtureを追加する。
2. R-2のDOM読み取りとtemplate値を抽出済み。正規化・renderer・round-tripを追加する。
3. R-1を、挙動を変えない小さな責務単位で分割する。
4. R-3とR-4を、現在の未コミット変更と実ブラウザー確認が落ち着いた後に分割する。
5. 負荷計測が必要なR-5・R-6、移行を伴うR-9、配布整理のR-10へ進む。

## 分割時の制約

- `content_scripts`はclassic scriptの順序で読み込まれるため、いきなりES moduleへ全面移行しない。
- `extensions/custom/`の`window.opd_custom_*` APIと、iframeへ注入するhelperの境界を維持する。
- `column_history`はXの非同期SPA遷移とjoint session historyに依存するため、純粋なstack操作と副作用のナビゲーションを分ける。
- `style.order`による表示順とiframe DOMの保持を壊さない。ラックをまたぐ移動だけは既存のDOM移動経路を使う。
- 未コミットのコード、テスト、ドキュメント変更をリセット・上書きしない。

## 今回の監査で対応しないもの

- `misskey` / `bsky`の描画対応。描画、保存、import、移行テストを同時に実装できるまで保留する。
- タイムラインのリアルタイム流し込み。現行の周期更新とは別機能であり、GraphQL応答や通知購読の設計が必要。
- ログイン済みXで未確認の挙動を、Nodeテスト成功だけで完了扱いにしない。

## 関連文書

- 現在の残課題: [backlog.md](backlog.md)
- カラム内の戻るの機序: [issue-column-back-navigation.md](issue-column-back-navigation.md)
- 共通検証手順: [verification.md](verification.md)
- 過去の監査: [docs/archive/README.md](archive/README.md)
