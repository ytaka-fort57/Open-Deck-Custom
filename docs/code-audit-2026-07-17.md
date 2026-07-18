# Open-Deck Custom コード監査

監査日: 2026-07-17
対象: `custom` ブランチ `e431bcc`
範囲: JavaScript、HTML、マニフェスト、ロケール、パッケージスクリプト、GitHub Actions、既存ドキュメント

## 対応状況

2026-07-17 に H-1〜H-5、M-1〜M-7、L-1の実装修正を行った。本文中の行番号は監査対象 `e431bcc` 時点の発見箇所を示す。

| 項目 | 状況 | 対応概要 |
| --- | --- | --- |
| H-1 | 修正済み | 新規 Timeline / Explore の初期値を10秒へ統一 |
| H-2 | 修正済み | キャンセル、非整数、負数、範囲外を削除前に拒否 |
| H-3 | 修正済み | 標準ドラッグ、追加、削除、2段目削除、プロファイル追加・削除でもタブ状態を再配置 |
| H-4 | 修正済み | カラム単位のタイマー破棄処理を追加し、削除・切り替え・切断時に停止 |
| H-5 | 修正済み | 指摘を範囲検証・offset順へ正規化し、ID・選択状態と一体で処理 |

| 項目 | 状況 | 対応概要 |
| --- | --- | --- |
| M-1 | 修正済み | schema version 1のバックアップへ独自タブ状態を追加し、状態を含まない入力では旧状態を消去 |
| M-2 | 修正済み | タブ状態の全read-modify-writeを保存キューで直列化 |
| M-3 | 修正済み | 共通codecで内側JSON・プロファイル・カラム・独自状態を検証し、3キーを一括保存。旧ローダーも新画面へ統合 |
| M-4 | 修正済み | 未対応のブラウザーUI言語を英語へフォールバック |
| M-5 | 修正済み | 校正通信を15秒で中止し、失敗時も`finally`で操作ロックを解除 |
| M-6 | 修正済み | title、favicon、head、react-rootのobserverとページ全体listenerを一度だけ登録 |
| M-7 | 修正済み | PowerShell / Bashのパッケージを許可リスト方式へ変更し、Release CIへZIP検査を追加 |

| 項目 | 状況 | 対応概要 |
| --- | --- | --- |
| L-1 | 修正済み | iframeごとの最新メディアトークンを`WeakMap`で保持し、現在接続中のiframeだけを照合 |
| L-2 | 未対応 | 動画variant選択は実payload確認後に対応方針を決める |

H-3は現在存在する操作経路の不具合を修正した段階で、位置キーから安定 ID への移行は R-2として残す。実ブラウザーでの Chromium / Firefox 回帰確認も引き続き必要である。

## 1. 結論

構文エラー、壊れた JSON、マニフェストから参照されるファイルの欠落は見つからなかった。Chromium / Firefox の ZIP 生成も完了する。

監査時点の実装では、優先度「高」5件、「中」7件、「低」2件を確認した。高5件、中7件、低1件は上記のとおり実装修正済みで、L-2のみ未対応である。

1. 新規 Timeline / Explore カラムの自動更新間隔が 10 秒ではなく 10000 秒になる
2. プロファイル削除でキャンセル、負数、非数値を入力すると意図しないプロファイルを削除できる
3. 独自タブ保存が位置を識別子にしており、標準ドラッグ、追加、削除で別カラムへ付け替わる
4. 自動更新タイマーがカラム削除・プロファイル切り替え後も停止しない
5. 文章校正 API の指摘順が未整列の場合、選択した箇所とは別の修正を本文へ適用し得る

この監査と修正確認は静的解析とローカル検証を中心に行った。X の現行 DOM を使う実ブラウザー試験と Firefox 実機試験は含まないため、DOM 依存機能については別途スモークテストが必要である。

## 2. 優先度: 高

### H-1. 新規カラムの自動更新が約2時間46分間隔になる

確度: 確定
影響: 新規追加した Timeline / Explore で自動更新が実質的に動かない

- 保存値はミリ秒で、復元時に `1000` で割って秒表示している（`content.js:819`）。
- 設定保存時は入力秒数を `1000` 倍している（`content.js:1826`）。
- しかし新規 Timeline / Explore のテンプレートには `10000` を直接入れている（`content.js:1568`, `content.js:1598`）。
- そのため UI は `10000` 秒を表示し、タイマーは `10,000,000ms` になる。

修正案:

- 新規カラムでは `%column_auto_reload_time%` に `10` を渡す。
- 保存単位を定数化し、`DEFAULT_AUTO_RELOAD_SECONDS = 10` と `toStoredMilliseconds()` のような変換関数へ集約する。
- 「新規作成 → 10秒表示 → 保存値10000ms」の単体テストを追加する。

### H-2. プロファイル削除入力の不備で別プロファイルを削除できる

確度: 確定
影響: プロファイル構成のデータ損失

`content.js:1627-1666` は `Number(prompt(...))` の結果を検証せず `splice()` に渡している。

具体例:

| 入力 | JavaScript 上の値 | 結果 |
| --- | ---: | --- |
| キャンセル | `0` | 現在のプロファイルが P0 でなければ P0 の削除確認へ進む |
| `abc` | `NaN` | `splice(NaN, 1)` が P0 を削除する |
| `-1` | `-1` | 配列末尾のプロファイルを削除する |
| 小数 | 小数 | `splice()` が整数へ丸めた位置を削除する |

修正案:

- `prompt()` の戻り値を文字列のまま受け、`null` なら即 return する。
- 10進整数のみ許可し、`0 <= index < profile_store.length` を検証する。
- 現在プロファイル判定は検証済みの整数に対して行う。
- 削除前のプロファイル名・番号を確認文へ表示する。

### H-3. タブ保存の位置キーがカラム操作後に別カラムへ付け替わる

確度: 確定
影響: リロード後に Timeline カラムの「おすすめ／フォロー中／リスト」が別カラムの選択へ戻る

独自タブ状態は `profile_index:timeline_index` をキーにする（`extensions/custom/column_state.js:84-96`）。この方式では、Timeline カラムの位置が変わるすべての操作で状態の再配置が必要になる。

現在再配置するのは独自の左右ボタン／表示順選択だけである（`extensions/custom/column_reorder.js:111-143`）。次の経路には再配置がない。

- 本家由来のドラッグ＆ドロップ（`content.js:1725-1739`）
- Timeline カラム削除（`content.js:1753-1763`）
- Shift を押しながら先頭へ Timeline カラム追加（`content.js:1563-1575`）
- プロファイル追加・削除によるプロファイル番号の移動（`content.js:1608-1666`）

修正案:

- 本命はプロファイル内の各カラムへ永続的な `column_id` を付け、タブ状態を `profile_id:column_id` で保存すること。
- 移行期間は、カラム操作を一つのサービスへ集約し、標準ドラッグ・追加・削除・独自移動の全経路で同じ remap を通す。
- 既存の位置キーから ID キーへの一度限りのマイグレーションを用意する。

### H-4. 自動更新タイマーが削除済みカラムを保持し続ける

確度: コード上で確定、実ブラウザーで副作用確認が必要
影響: メモリ保持、非表示カラムの更新、API レート消費、プロファイル切り替え回数に応じた負荷増加

自動更新は `setInterval()` を作る（`content.js:1289-1304`, `content.js:1389-1404`）が、タイマー ID はイベントハンドラー内のローカル変数に閉じている。次の DOM 破棄時に `clearInterval()` が呼ばれない。

- プロファイル切り替えでデッキ全体を削除（`content.js:980`）
- カラムを閉じる（`content.js:1756`, `content.js:1761`）

また、自動更新を有効にしたまま間隔値を変更しても、既存タイマーは作り直されない（`content.js:1271-1280`）。表示・保存値と実際の周期が次回切り替えまで一致しない。

修正案:

- カラム単位の controller にタイマー ID を保持し、`dispose()` で必ず停止する。
- カラム削除・プロファイル切り替え・拡張再初期化の前に dispose する。
- 間隔変更時は有効中のタイマーを停止して新しい周期で再作成する。
- タイマー内でも `iframe.isConnected` を確認し、切断済みなら自己停止する。

### H-5. 文章校正で選択と適用対象がずれる可能性がある

確度: 条件付きで確定
条件: API の `indications` が offset 昇順で返らない、または範囲が重なる
影響: 投稿前の本文へユーザーが選んでいない修正を適用する

指摘一覧の ID と選択状態は API の元配列順で作られる（`extensions/text_review.js:247-262`）。一方、プレビューと本文生成は指摘を offset 順へ並べ替えた後、並べ替え後の添字で元の ID・選択配列を参照している（`extensions/text_review.js:304-375`）。API が未整列なら対応がずれる。

重複範囲をスキップした場合も、一覧側には項目が残り、存在しないプレビュー要素へ `scrollIntoView()` を呼び得る（`extensions/text_review.js:267-279`, `extensions/text_review.js:321-322`）。

修正案:

- `{ indication, id, enabled }` を一つのオブジェクトとして組み立ててから sort する。
- 表示、選択、本文生成のすべてで同じ正規化済み配列を使う。
- 未整列、同一 offset、重複範囲、範囲外 offset のテストを追加する。

## 3. 優先度: 中

### M-1. カスタム設定のバックアップが独自タブ状態を含まない

`extensions/custom/settings_import.html:38` は「設定とカラム構成をまとめて」バックアップできると説明するが、書き出すのは `opd_settings` と `opd_profile_store` だけである（`extensions/custom/settings_import.js:103-115`）。`opd_custom_column_state` は出力・入力されない。

さらにインポート時に既存の独自タブ状態を消さないため、新しいプロファイル構成へ旧環境の位置キーが適用され得る。H-3 の安定 ID 化と一緒に、スキーマバージョン付きで全カスタム状態を export / import する。

### M-2. タブ状態の read-modify-write が競合する

`save_tab()` は storage 全体を読み、1項目を変更して全体を書き戻す（`extensions/custom/column_state.js:94-104`）。複数カラムのクリックや remap が近接すると、同じ古い値を読んだ後の後勝ちとなり、片方の更新が消える可能性がある。

保存キューで直列化するか、プロファイル／カラムごとに storage キーを分離する。Promise ベースの単一 persistence 層へ統合すると H-3、M-1 も同時に整理しやすい。

### M-3. 設定インポートの検証・原子性が不足する

- 外側 JSON の parse だけを catch し、文字列化された内側の `opd_profile_store` / `opd_settings` の parse は例外処理外（`extensions/custom/settings_import.js:13-21`, `:84-94`）。
- profile の検証は `name` と `profile` の存在だけで、`profile` が配列か、カラム型・数値・URL が妥当かを見ない（`:34-41`）。
- profile store を先に保存し、その後 settings を処理するため、後半で失敗すると部分更新になる（`:43-63`）。
- 旧 `profile_debug.js` は未検証文字列を storage へ直接保存できる（`profile_debug.js:8-38`）。起動側も `JSON.parse()` 失敗を復旧しない（`content.js:120-192`）。

インポート前に全データを正規化・検証し、現在値のバックアップを作ってから一回の `chrome.storage.local.set()` で更新する。旧ローダーは新ローダーへ統合する。

### M-4. 日本語・英語以外のブラウザー UI 言語で Post 拡張が初期化失敗する

`chrome.i18n.getUILanguage()` の先頭言語をそのまま使う（`extensions/text_review.js:12`）一方、`UITexts` は `ja` と `en` だけである（`:409-470`）。例えば `fr` では `this.UITexts.fr` が `undefined` となり、ボタン HTML 作成時に例外になる（`:123-125`）。

`const lang = UITexts[requested] ? requested : "en"` のフォールバックを入れる。サポート外言語を含む初期化テストを追加する。

### M-5. 文章校正リクエストにタイムアウトと finally がない

background の `fetch()` にタイムアウトがなく（`background.js:24-45`）、呼び出し側は `await` 後にしか `review_state = false` へ戻さない（`extensions/text_review.js:189-198`）。応答が停止、または `sendMessage()` 自体が reject すると、スピナーと操作ロックが残る。

`AbortSignal.timeout()` 相当のタイムアウトを入れ、UI 側は `try/catch/finally` で必ず状態を解除する。レスポンスの `indications` 形状も確認する。

### M-6. プロファイル切り替えごとに MutationObserver が増える

`run()` は切り替えのたびに再実行される（`content.js:980-990`）。その中でタイトル・favicon・head・react-root 用の observer を作る（`content.js:872-889`, `:1963-2041`）が、旧 observer を disconnect しない。

デッキの controller に observer と listener を登録し、再構築前に一括破棄する。タイトル・favicon の監視はページ単位で一度だけ初期化すればよい。

### M-7. パッケージへ開発用・ローカル用ファイルが混入する

`package.ps1` を実行し、両 ZIP の内容を検査して確認した。生成物には次が含まれた。

- `.agents/skills/git-flow/SKILL.md`
- `.claude/settings.json`
- `.claude/settings.local.json`
- `.claude/skills/git-flow/SKILL.md`
- `.githooks/pre-commit`
- `docs/*`

特に `.claude/settings.local.json` はローカル絶対パスや開発時の許可コマンドを含み、ローカル配布物へ不要な情報を混ぜる。CI では未追跡の local ファイルは存在しないが、追跡済み開発ファイルと docs は現在の release ZIP に入る。

除外リストを増やすより、マニフェスト、実行コード、HTML、画像、ロケールだけを明示した allowlist 方式へ変更する。ZIP 内容を検証する CI テストも追加する。

## 4. 優先度: 低 / 要経過観察

### L-1. メディアトークンが iframe 再読込ごとに増える（修正済み）

カラム iframe の load ごとに新しい blocker token を `media_viewer_token` へ追加するが削除しない（`content.js:1668-1702`）。長時間利用時に配列と古い token が増える。iframe ごとの最新 token を `WeakMap` で保持するか、再初期化時に置換する。

対応では`WeakMap<iframe, token>`へ置き換えた。同じiframeの再読込では最新値に置換され、削除済みiframeは強参照されない。メディア情報受信時は現在の`#main_rack_element`内に接続されているiframeだけを照合するため、旧documentから届いた古いtokenも受け付けない。

### L-2. 動画 variant を配列末尾だけで選ぶ

表示・ダウンロードとも `video_info.variants.at(-1)` を使う（`extensions/media_viewer/media_viewer.js:16`, `:51`, `:145`, `:164`, `:210`）。variant の順序や content type を確認せず、環境によっては HLS playlist や意図しない品質を選ぶ可能性がある。

`content_type === "video/mp4"` を優先し、bitrate 最大の候補を選ぶ共通関数へ集約する。実際の X の media payload を使った確認が必要である。

## 5. リファクタ対象

本家`upstream/Release`を同期PRで継続的に取り込む方針を踏まえ、2026-07-17時点では次のように判断した。

| 項目 | 方針 | 理由 |
| --- | --- | --- |
| R-1 `content.js`のライフサイクル分割 | 第1段階対応済み | `extensions/custom/lifecycle.js`へタイマー破棄、ページ監視、共有イベント、メディアトークンを移し、`content.js`側は呼び出しへ限定した |
| R-2 安定ID | 設計保留 | 保存スキーマと本家のカラム生成・保存経路を同時に変えるため競合範囲が大きい。当面の位置キーremapで既知操作を補う |
| R-3 storage統合 | 独自領域は対応済み、全面移行は保留 | import/exportは`extensions/custom/settings_codec.js`へ分離済み。本家`content.js`内の保存処理まで一括移動するのは同期競合が大きい |
| R-4 DOM adapter | 新規独自機能から適用 | 既存helperの一括移動は行わず、`extensions/custom/`側の新規実装でselectorを集約する |
| R-5 再現可能な検証 | 対応済み | Node標準テスト14件とWindows / Bashの必須検証入口を追加し、Release CIも同じ`verify.sh`を実行 |

### R-1. `content.js` のライフサイクル分割

`content.js` は約2050行あり、`run()` が UI 生成、保存、イベント、タイマー、observer、拡張初期化を同時に担当する。プロファイル切り替えが `run()` の再帰的な再実行になっているため、H-4 と M-6 のような破棄漏れが起きやすい。

推奨分割:

```text
DeckController
├─ ProfileRepository
├─ ColumnRepository
├─ ColumnFactory
├─ ColumnController[]
│  ├─ AutoReloadController
│  ├─ ViewModeController
│  └─ ExtensionController
└─ DisposableRegistry
```

一度に全面書き換えず、最初に AutoReloadController と persistence 層を切り出すと高優先度不具合へ直接効く。

第1段階では`extensions/custom/lifecycle.js`を追加し、プロファイル切り替え後もページ単位で一つだけ存在すべきlistener／observerと、iframeに紐づく自動更新・メディアトークン管理を分離した。独立テストではlistenerの一重登録、古いiframe tokenの拒否、disposerの一括解放を確認する。

### R-2. 位置ではなく安定 ID をデータモデルの中心にする

プロファイル番号・Timeline の表示位置を状態キーにしていることが、H-3、M-1、M-2 の共通原因である。`profile_id` と `column_id` を永続化し、並べ替えは配列順だけを変える設計へ移行する。

### R-3. storage スキーマとマイグレーションを一本化する

現在は複数ファイルが JSON 文字列を個別に parse / stringify する。次を一つの repository へ集約する。

- スキーマバージョン
- parse とデフォルト値
- バリデーション
- 旧形式の移行
- 原子的な import / export
- 書き込み直列化

### R-4. DOM 依存セレクターを adapter として隔離する

X の React 内部プロパティや DOM 構造へ依存する箇所は `text_review_helper.js`、`auto_reload_helper.js`、`media_viewer_block_helper.js` に散らばる。機能ロジックとセレクター／React adapter を分け、DOM fixture に対するテストを可能にする。

### R-5. パッケージとテストを再現可能にする

`package.json` がなく、標準のテスト・lint コマンドもない。大規模なツール導入までは不要だが、最低限次をリポジトリ内の単一コマンドで実行できるようにする。

- 全 JavaScript の `node --check`
- manifest / locale JSON parse
- manifest 参照ファイル存在確認
- locale キー一致
- persistence / remap / profile delete の単体テスト
- ZIP allowlist 検査

対応として、`node tests/run.mjs`へコード回帰を集約し、Windowsでは`.\verify.ps1`、Linux / GitHub Actionsでは`./verify.sh`で回帰テスト、両ブラウザーのZIP生成、内容検査まで一括実行できるようにした。npm依存は追加していない。

## 6. 既存バックログとの突き合わせ

`docs/backlog.md` は現在の実装と一部ずれている。

- 「並べ替え・追加・削除でタブ対応がずれる」は、独自の並べ替えボタン経路だけ修正済み。標準ドラッグ、追加、削除、プロファイル操作は H-3 として残る。
- 「同期 Pull Request の自動化」は `.github/workflows/sync-upstream.yml` が存在するため、実行権限と初回動作確認を残す記述へ更新すべきである。
- Firefox 未検証は引き続き有効。`Element.moveBefore()` は対応が限定的で、未対応時は既存の `insertBefore()` フォールバックにより iframe が再読み込みされる設計である。互換性は [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore) を基準に実機確認する。
- X 内の戻るボタン問題は残る。Backspace 独自履歴は別機能として動作するが、X のボタン操作は同じ経路へ統合されていない。

## 7. 推奨する実装順

1. H-1 自動更新の単位修正と回帰テスト
2. H-2 プロファイル削除入力の検証
3. H-4 タイマー dispose と間隔変更時の再作成
4. H-3 安定 ID 方針の設計、当面の全操作経路 remap
5. M-1 / M-2 / M-3 storage・import/export の統合
6. H-5 校正指摘の正規化
7. M-5 タイムアウトと UI finally
8. M-7 パッケージ allowlist
9. M-4 / M-6 と R-1 の段階的整理
10. Chromium / Firefox の実ブラウザースモークテスト

H-1、H-2、H-4 は互いの変更範囲が比較的小さく、先に独立コミットで直せる。H-3 はデータ移行を伴うため、実装前にスキーマと後方互換方針を短い設計文書へ固定するのが安全である。

## 8. 実施した検証

| 検証 | 結果 |
| --- | --- |
| 全 `.js` の `node --check` | 成功 |
| `manifest.json`, `manifest_firefox.json` の JSON parse | 成功 |
| 日英 locale JSON parse | 成功 |
| 日英 locale キー比較 | 80キー一致 |
| manifest 参照ファイル存在確認 | 欠落なし |
| `git -c core.whitespace=cr-at-eol diff --check` | 問題なし |
| `package.ps1` による Chromium / Firefox ZIP 生成 | 成功 |
| ZIP 内 manifest parse | 成功 |
| ZIP 内容の許可リスト・開発用ファイル混入確認 | Chromium / Firefoxとも許可リスト内の58項目、混入なし |
| H-1〜H-5 回帰ロジック（状態コピー・削除・並べ替え・追加・削除・指摘正規化） | 成功 |
| M-1〜M-3 保存回帰（新旧形式、不正入力拒否、3キー一括生成、並行更新直列化） | 成功 |
| M-4〜M-5 校正回帰（未対応言語、メッセージ拒否、通信タイムアウト） | 成功 |
| L-1 メディアトークン回帰（同一iframe再読込時の置換、削除済みiframeの除外） | 成功 |
| `package.sh` Bash構文検査 | 成功 |

H・M・L-1項目の修正後にも全 JavaScript 構文、改行コード、両 ZIP 生成と ZIP 内 manifestを再検証し、すべて成功した。

未実施:

- X にログインした Chromium での回帰試験
- Firefox での Manifest V2 実機試験
- 文章校正 API の実通信
- GitHub Actions の手動 dispatch
- Store 提出時の validator / reviewer 相当の検査
