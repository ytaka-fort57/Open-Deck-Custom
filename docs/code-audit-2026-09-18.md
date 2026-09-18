# Open-Deck Custom リファクタ候補監査

監査日: 2026-09-18  
対象: `custom` ブランチ作業ツリー(`e86e2ae` 時点)  
目的: 前回監査(R-1〜R-10)の進捗を確認し、コードを読み直して新しい候補(R-11〜R-24)を洗い出す

## 結論

R-2(設定モデル)とR-8(実DOMテスト)は完了し、Playwright E2Eが`content.js`全体の回帰網になった。
残る最大の課題は依然として`content.js`の`run()`(約1,680行、220〜1898行目)で、今回の読み直しで
次が新たに分かった。

- iframe内へCSSを流し込む処理が3か所に複製され、CSS本文も微妙に食い違っている(R-11)
- カラム削除のたびに全iframeへ`load`リスナーが追加され続ける(R-12)。プロファイル切替のたびに
  並び替え保存リスナーが増える(R-13)。いずれも保存の直列化で壊れてはいないが、無駄が積み上がる
- 到達不能分岐、設定されない属性、divへの`.value`代入など、本家由来の死コードが残っている(R-14)
- `_locales`にキーがあるのにテンプレートは日本語直書きになっている(R-15)

R-1の「責務単位の段階分割」は、R-11(iframe CSS境界)とR-20(デッキCSS分離)を先に行うと
`content.js`を約1,000行減らせ、その後の`column_controller` / `profile_controller`分割が読みやすくなる。

この監査はコード構造の整理であり、ログイン済みX上の実動作を保証するものではない。

## 検証結果

- `node tests/run.mjs`: 74/74 成功(今回の監査で変更なし)
- `verify.ps1`、`npm run test:e2e`: 今回は未実行。前回監査時の成功状態から関連ファイルの変更なし
- 作業ツリーは未コミットの`.agents/`のみ。コード変更は行っていない

## 前回候補(R-1〜R-10)の状態

| ID | 状態 | 補足 |
| --- | --- | --- |
| R-1 | 未着手 | `run()`は依然約1,680行。R-11・R-20を先に切り出すと約1,000行減る |
| R-2 | 対応済み | `column_settings.js` / `column_dom.js` / `settings_codec.js` とE2E round-trip |
| R-3 | 未着手 | 履歴・戻るの判定表テストは`column_history.test.mjs`と`column-back.spec.mjs`で一部固定済み |
| R-4 | 未着手 | `lifecycle.js`は270行で安定。分離の緊急度は下がった |
| R-5 | 未着手 | `index.js:258`のMutationObserverは依然としてDOM変更ごとに5処理を全走査 |
| R-6 | 未着手 | `list_repost_filter.js`は50ms debounce済み(342〜352行目)。差分走査は計測後 |
| R-7 | 未着手 | プロファイル一覧HTMLは3か所(229, 1649, 1699行目)。R-17・R-19と一緒に行う |
| R-8 | 対応済み | Phase 1・2・4実装済み。Phase 3(CI)は安定確認後 |
| R-9 | 保留 | 変更なし |
| R-10 | 未着手 | R-24で即効策を具体化 |

## 新しいリファクタ候補

優先度は「回帰リスクの低減」と「R-1に進むための下準備」を基準にした。
行番号は`content.js`の現行版(2,005行)を指す。

### 優先度: 高

#### R-11 iframe内CSS適用の三重複を`column_frame_css`へ集約

コード上の事実:

- バナー非表示、トップ非表示、表示モードのCSSを、次の3か所がそれぞれ`contentWindow.document`へ書く
  - `append_object_css`内の`load`リスナー: 989〜1048行目
  - 一度きりの初期化`load`リスナー: 1244〜1292行目
  - 各チェックボックス・selectの`change`リスナー: 1337〜1443行目
- CSS本文が食い違う。バナー非表示は1011・1256行目が`display:none`、1347行目が
  `visibility: hidden; width: 0;`。いずれも末尾が`};`で閉じ括弧の後にセミコロンが付く
- `get_top_visible_css`(58〜85行目)だけが関数化され、表示モードのCSS(3種)は3か所に文字列で複製されている
- `<style opd_*_css>`の有無確認と挿入も毎回同じ手順

推奨:

- `extensions/custom/column_frame_css.js`を追加し、純粋関数`banner_css(visible)`、
  `top_visible_css(column_type, visible, legacy_mode)`、`view_mode_css(mode)`と、
  `apply(doc, style_attr, css_text)`(styleの確保と`textContent`更新)を置く
- `get_top_visible_css`は`content.js`から移す。`tests/content_regression.test.mjs`の
  `top visibility keeps timeline tabs available`と`post top visibility ...`は参照先を新ファイルへ変更する
- 3か所の呼び出しは`column_frame_css.apply(...)`1行ずつに置き換える。挙動は変えず、
  バナーCSSは既存の初期化側(`display:none`)へ統一する

検証: Nodeで3関数の出力を固定。E2E `open-deck-profile`で初期描画後のiframe headに
`style[opd_banner_css]`等が1本ずつ存在することを確認する。

#### R-12 `append_object_css`の`load`リスナー蓄積を止める

コード上の事実:

- 989行目の`load`リスナーにはガードがない。1052行目のガード(`opd_column_ui_loader_added`)は
  2本目のリスナーだけを守る
- `append_object_css()`は引数なしだと全iframeを再走査する(974行目)。カラム削除(1833, 1841行目)の
  たびに、残った全iframeへ同じ`load`リスナーがもう1本追加される
- `watch_load_column`(978行目)と`mutate_url`(1455→1477行目)も同じ経路で毎回登録される。
  `mutate_url`は内部で旧observerを`disconnect`するため二重監視にはならないが、リスナー数は増える
- `mode`引数は`"session_set"` / `"add_column"` / 未指定の3値。`"session_set"`で呼ぶ箇所は
  存在せず(10か所の`mode != "session_set"`判定はすべて真)、Desktop版との共通化の名残

推奨:

- R-11と同じコミット列で、iframe単位の初期化を`lifecycle.register_column_resource(frame, "frame-css", dispose)`で
  1回に限定する。`register_column_resource`は同じキーの再登録で前のdisposerを呼ぶため、
  蓄積せずに置き換わる
- `append_object_css`の引数なし呼び出しを「削除で残ったiframeの再初期化」ではなく「何もしない」に変え、
  削除時の呼び出し(1833, 1841行目)を外す。削除で他カラムのCSSを再適用する必要はない
- `"session_set"`分岐は削除する

検証: `tests/lifecycle_dom.test.mjs`のfixtureで、追加→削除→追加後に各iframeの
`listeners.get("load").length`が増えないことを固定する。

### 優先度: 中

#### R-13 `opd_custom_column_reordered`リスナーが`run()`ごとに増える

- 1503行目で`document.addEventListener("opd_custom_column_reordered", ...)`を`run()`内で登録する
- `run()`はプロファイル切替(962行目)で再実行されるため、N回切り替えると並び替え1回で
  `column_settings_save`がN+1回走る。`set_json`は直列化されているため保存内容は壊れないが、
  storage書き込みが増える
- `initialize_page_event_listeners`は`lifecycle.js`で一度きりに守られており、こちらだけ漏れている

推奨: `run()`の外(トップレベル)で1回だけ登録し、ハンドラー内で`last_load_profile`を参照する。
または`lifecycle`に`initialize_page_event_listeners`と同じ一度きり登録を足す。

検証: E2E `profile-switch`で、切替後に並び替えを1回行い`opd_profile_store`の書き込み回数
(storage `onChanged`の発火数)が1であることを確認する。

#### R-14 死コード・到達不能分岐の整理

| 箇所 | 事実 |
| --- | --- |
| 135〜155行目 | `location.href == ".../run-opdeck"`の内側で`pathname == "/run-opdeck_test.html"`を判定しており到達不能。Brave分岐はelseと同一 |
| 991, 1244行目 | `opd_iframe_width_only`属性はどこにも設定されない。`getAttribute`は`null`で`null != ''`は常に真。「他SNS対応」の名残 |
| 809, 812行目 | `othersns_default_element_bar`、`column_settings_panel_othersns`は未使用 |
| 893, 1540, 1556行目 | `#second_rack`は`div`のため`.value = "Single Rack"`は無効。表示はbackground-image差し替えで行われている |
| 254, 1548行目 | `<style second_column_css>`は空のまま使われず、1548行目で空文字を再代入するだけ |
| `column_dom.watch_load_column` | `onLoad`本文が空の`try/catch`で何もしない。`fbdc939`「ロード失敗時のリロードを仮実装」の名残で、テスト(`column_dom.test.mjs:122`)も無動作を固定している |
| 1122, 1872行目 | `is_auto_update(stale_check)`の`stale_check`は常に既定値`false`。5分stale判定は死んでいる |
| 962行目 | `run(column_settings, profile_store)`の第2引数は`run(settings)`で受け取られない |
| 1218行目 | `setting_width_num != NaN`は常に真。`> 11`でNaNは弾かれるため実害はないが`Number.isNaN`へ |
| 990, 1691行目、`utils_helper.js:3` | デバッグ`console.log`の残骸。コメントアウトされた旧コードは`content.js`に44行 |

推奨: 本家ファイルの差分を増やす作業なので、R-11・R-12と同じ作業ブランチで1コミットにまとめる。
`watch_load_column`を消す場合は「ロード失敗検出」を本当に実装するかを先に決める。
実装しないなら関数・テスト・呼び出しをまとめて削除する。

#### R-15 i18nの取りこぼし

- `_locales`に`ui_column_close_title`、`ui_column_pin_toggle_title`、`ui_empty_column_message`、
  `ui_second_empty_column_message`、`ui_column_post_title`、`ui_column_timeline_title`、
  `ui_column_notifications_title`、`ui_column_explore_title`が定義済み
- しかし`content.js`のテンプレート(815〜820行目)は「カラムを閉じる」「左のバーからカラムを追加」
  「1段目のカラムが配置できます」「ピン止め切り替え」「Post」「Timeline」「Notifications」「Explore」を直書き
- カスタム側も直書きがある: `column_reorder.js:299〜301`(左へ移動 / 表示順 / 右へ移動)、
  `index.js:34〜35`(設定インポート)

推奨: 既存キーへ差し替える。カスタム側は新キーを`_locales/ja`と`_locales/en`へ追加する
(`project_integrity.test.mjs`が両localeのキー一致を検査する)。
`text_review.js`の`UITexts`は本家構造のため今回は対象外。

検証: `project_integrity.test.mjs`に「`content.js`の`default_element`テンプレートに
日本語リテラルが含まれない」検査を追加する。

#### R-16 カラム幅プリセットの写像が3か所

- 1172〜1185行目(初期選択)、1189〜1202行目(select変更)、1222〜1235行目(手入力後)で
  `15 / 20 / 30 ↔ 0 / 1 / 2`のswitchを繰り返す

推奨: `column_settings.js`に`WIDTH_PRESETS = [15, 20, 30]`、`width_preset_index(width)`、
`width_from_preset(index)`を置き、3か所を置き換える。Nodeで往復を固定する。

#### R-17 `column_settings_save`のmode文字列を分ける

- `column_settings_save("", last_load_profile)`が24か所、`column_settings_save("profile_out")`が1か所
- 保存側は`profile_store[profile_num]`へ`Object.assign`してから`set_json`する。読み取りと保存が
  1関数に同居しているため、呼び出し側が`""`を渡す

推奨: `read_current_profile()`(読み取りのみ)と`save_current_profile()`(読み取り+保存)に分ける。
R-7の`profile_controller`へ寄せる際の最初の1歩になる。

#### R-18 `settings_init`の既定プロファイルが`normalize`と二重定義

- 1982行目の配列は、`column_settings.normalize`の既定値(`banner:false, top_visible:true, tw_view_mode:"0", ...`)を
  5要素分手書きしている。キー順も要素ごとに不揃い

推奨: `column_settings.default_profile()`を追加し、`new_column_setting(type)`から組み立てる。
`home`の`banner:true`だけ上書きする。`settings_codec.validate_profile_store(default_profile())`が真になることを
Nodeで固定する。

#### R-19 プロファイル説明文の生成は純粋関数

- 907〜949行目はプロファイル配列からi18nキーを選んで文字列配列を作るだけで、DOMに触れない
- `misskey` / `bsky`ケースは描画対象外なのに残っている(backlog「対応しない」項目)

推奨: `profile_summary(profile, i18n_message)`として`column_settings.js`(またはR-7の`profile_controller`)へ移し、
Nodeで各typeの出力を固定する。`misskey` / `bsky`は`default`へ落とす。

#### R-20 デッキ本体CSS(約550行)を`content.js`から分離

- 254〜805行目の`<style opd_default_css>`は、`chrome.runtime.getURL(...)`を`url()`に埋め込むためだけに
  JSテンプレート文字列になっている
- `.dsp_btn_add_post_img`〜`.dsp_btn_profile_delete_img`の7クラスが同じ`filter`と
  `background-size / repeat / height / width`を繰り返し、ダークモード側でも7クラスを列挙している

推奨:

- `deck.css`を追加し、`run()`では`<link rel="stylesheet" href="${chrome.runtime.getURL("deck.css")}">`を
  1行挿入する。スタイルシート内の相対`url(icon/settings.svg)`はスタイルシートURL基準で解決されるため
  `getURL`は不要
- manifestの`content_scripts.css`は使わない。全x.comページ(カラムiframeを含む)へ効き、
  `html{overflow-y:hidden !important}`や`::backdrop`が漏れる
- 7クラスの共通部分を`.dsp_btn_img`へ寄せ、`background-image`だけ個別に残す
- `deck.css`を`web_accessible_resources`と`package.sh` / `package.ps1` / `verify.sh` / `verify.ps1`の
  許可リストへ追加する(R-24と同時に行うと重複編集を1回で済ませられる)

検証: E2E `open-deck-profile`は`#opd_main_element`の`toBeVisible`を既に持つ。
加えてサイドバーボタン1点の`background-image`が`chrome-extension://`で始まることを確認する。

### 優先度: 低

#### R-21 ヘルパー注入パターンの共通化

- `utils.js`、`auto_reload.js`、`media_viewer_block.js`、`text_review.js`の`Init`が
  「script要素生成 → `getURL` → head追加 → `crypto.randomUUID()` → `load`後に`CustomEvent`でtoken送信」を
  それぞれ実装する
- `get_props` / `getProps` / `getFiber`が`auto_reload_helper.js:84`、`media_viewer_block_helper.js:123`、
  `text_review_helper.js:246, 252`で重複する

推奨: `extensions/custom/helper_injector.js`に`inject(column_window, src, init_event_name)`を置き、
本家クラスの`Init`から呼ぶ。React props取得の共通化は、動的挿入scriptの実行順が保証されない
(`async`既定)ため、`script.async = false`で順序を固定するか、各ヘルパーに残す。

#### R-22 小さな重複ユーティリティ

- `text_review.js:427 EscapeHTML` ≒ `safe_values.escape_html_attribute`(`'`の扱いだけ違う)
- `text_review.js:419 CreateRandomID` ≒ `content.js:1895 create_random_id`
- `is_loaded(iframe)`が`index.js:42`と`list_repost_filter.js:375`で二重
- `is_shift_pressed`のグローバル`keydown` / `keyup`追跡(93〜98行目)は、追加ボタンの`click`イベントの
  `event.shiftKey`で置き換えられる

#### R-23 `column_history`のポーリングをカラム数に比例させない

- `track()`がiframeごとに400ms周期の`setInterval`を持つ。カラム10本で毎秒25 tick
- 1本のタイマーで追跡中の全iframeを回す形にでき、挙動は同一

推奨: CPU占有が確認できてから行う。`column_history.test.mjs`はfake timerで周期を固定しているため、
タイマー構造を変えるとテスト側の`tick`呼び出しを調整する。

#### R-24 manifest / 配布定義の生成(R-10の具体化)

- `content_scripts.js`(18ファイル)と`web_accessible_resources`(35項目)が`manifest.json`と
  `manifest_firefox.json`で完全複製
- 配布許可リストが`package.sh` / `package.ps1` / `verify.sh` / `verify.ps1`の4か所

推奨:

- 即効策: `project_integrity.test.mjs`に「両manifestの`content_scripts[0].js`配列と
  `web_accessible_resources`の項目集合が等しい」検査を足す。ファイル追加漏れをその場で検出できる
- 中期: `scripts/build_manifest.mjs`(Node標準のみ)で`manifest.json`から`manifest_firefox.json`を生成し、
  生成結果と一致することをテストで検査する。手書きを残す場合でも差分検査だけで十分に効く

## 着手順

1. R-15、R-16、R-18、R-19、R-24(即効策): `content.js`の差分が小さく、Nodeテストで固定できる。
   1候補1コミットで進める
2. R-11 + R-12 + R-13 + R-14: iframe CSS境界の切り出しと、その周辺の蓄積・死コード整理を同じ作業ブランチで行う。
   `content.js`は約450行減る。E2E `open-deck-profile` / `profile-switch`で回帰を見る
3. R-20: デッキCSSの分離。約550行減り、`run()`はカラム操作と保存だけになる
4. R-17 + R-7: `profile_controller`へプロファイル一覧描画・切替・追加・削除・保存を集約する
5. ここまでで`content.js`は1,000行未満になる見込み。改めてR-1の`column_controller`分割とR-3・R-4に進む
6. R-21〜R-23とR-5・R-6は、必要性か負荷が確認できてから

## 分割時の制約

前回監査の制約はそのまま有効。

- `content_scripts`はclassic scriptの順序で読み込まれるため、いきなりES moduleへ全面移行しない。
  新ファイルは`manifest.json`と`manifest_firefox.json`の両方で`content.js`より前に置き、
  `project_integrity.test.mjs`の順序検査へ追加する
- `extensions/custom/`の`window.opd_custom_*` APIと、iframeへ注入するhelperの境界を維持する
- `tests/content_regression.test.mjs`は`content.js`の文字列を検査している。関数を移す際は
  テストの参照先を新ファイルへ同時に更新し、検査自体を消さない
- `style.order`による表示順とiframe DOMの保持を壊さない
- 改行コードは本家に合わせる(`.gitattributes`)。`content.js`はCRLF、`extensions/custom/`はLF
- 本家更新は意味移植する。`content.js`の死コード削除(R-14)は、本家差分を読む際の読み替えが必要になるため、
  [upstream-port-log.md](upstream-port-log.md)に削除箇所を記録する

## 今回の監査で対応しないもの

- `misskey` / `bsky`の描画対応(保留のまま)
- タイムラインのリアルタイム流し込み
- `text_review.js`の`UITexts`を`_locales`へ移す変更。本家構造の変更幅が大きい割に効果が小さい
- `background.js`。145行で責務が明確なため対象外

## 関連文書

- 現在の残課題: [backlog.md](backlog.md)
- 前回監査(R-1〜R-10の定義): [archive/code-audit-2026-09-11.md](archive/code-audit-2026-09-11.md)
- 実DOM E2E基盤設計: [browser-e2e-test-design.md](browser-e2e-test-design.md)
- カラム内の戻るの機序: [issue-column-back-navigation.md](issue-column-back-navigation.md)
- 共通検証手順: [verification.md](verification.md)
- 過去の監査: [archive/README.md](archive/README.md)
