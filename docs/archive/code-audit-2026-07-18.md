# Open-Deck Custom コード監査（フォローアップ）

状態: 2026-07-26監査へ引き継ぎ済みのためアーカイブ

監査日: 2026-07-18
対象: `custom` ブランチ `0c1bc54`
範囲: 前回監査（`docs/archive/code-audit-2026-07-17.md`）の H/M/L/R 対応後に、重複しない新規の見落としを探す再点検
方法: `content.js` / `extensions/custom/` / 周辺（background・text_review・media_viewer・manifest・CI・package・tests）の3系統を精読し、報告された指摘を実コードで再検証した。実害なしと確認したものは除外し、コードで確認できた項目のみ記載する。

## 結論

前回の H-1〜H-5・M-1〜M-7・L-1 は修正を確認した。今回の確定項目は、N-4を除いて高・中を修正し、低のうち権限境界・障害通知・保存失敗の可視性に効くN-6/N-9/N-10も修正した。N-4は現行deckが`misskey`/`bsky`を描画できず利用予定もないため保留とする。

| 項目 | 優先度 | 状況 | 概要 |
| --- | --- | --- | --- |
| N-1 | 高 | 修正済み | 属性テンプレートを共通escapeし、メディア要素はDOM生成＋HTTPS URL検証へ変更 |
| N-2 | 高 | 修正済み | 制御文字・長さ・X同一オリジン相対pathをcodecで検証 |
| N-3 | 中 | 修正済み | 間隔変更時、ONなら走行中timerを新しい周期で再作成 |
| N-4 | 中 | 保留 | 現行deckで描画不能かつ利用予定なし。対応型追加時にcodecと同時実装する |
| N-5 | 中 | 修正済み | iframe参照を安全に読み、cross-origin/遷移中は次回loadへ委ねる |
| N-6 | 低 | 修正済み | `sender.id`とmessage形式を検証し、未知messageを拒否 |
| N-7 | 低 | 保留 | iframe documentの寿命に限定され実害が小さい。汎用column disposer導入時に統合する |
| N-8 | 低 | 一部対応 | 安全値・sender・storageを実行テスト化。巨大な`content.js`全体のDOM testは継続課題 |
| N-9 | 低 | 修正済み | `FileReader`のerrorを画面へ表示し入力欄をクリア |
| N-10 | 低 | 修正済み | `undefined`返却をエラー化し、明示的no-op用`NO_CHANGE`を追加 |

---

## 優先度: 高

### N-1. 未エスケープ文字列の `innerHTML` 展開（HTML/属性インジェクション）

確度: HTML/属性注入は確定。スクリプト実行は X 側 CSP 次第で、DNR による CSP 除去のため成立余地あり
影響: 拡張の content script 特権コンテキストである deck 文書へ、属性脱出による任意 DOM／iframe 注入

共通原因は「信頼できない文字列を二重引用符属性内へ無エスケープで埋め、`innerHTML` で解釈する」こと。3 箇所で成立する。

1. **Explore カラムのタイトル／パス（ライブ由来）**
   - テンプレート `opd_explore_title="%column_save_title%"`（`content.js:764`）へ `replaceAll("%column_save_title%", ...)`（`content.js:830,832`）で無エスケープ挿入し、`ins_html.innerHTML`（`content.js:846`）で解釈。
   - 値の出所は `content.js:1454-1458` で保存する Explore iframe の `contentWindow.document.title`（検索クエリ等の生文字列）。タイトルに `"` を含むと属性を突き破り、次回 `run()`（リロード／プロファイル切替）時に注入が発火する。
   - `%column_save_path%` も `src="https://x.com%column_save_path%"` に無エスケープで入るが、`location.pathname+search` 由来で URL エンコード済みのため実質リスクは低い。

2. **インポート JSON 経由（stored injection）** — N-2 と同一経路。上記テンプレートに、検証をすり抜けた `column_save_title` 等がそのまま流れ込む。

3. **メディアビューワーの URL**
   - `extensions/media_viewer/media_viewer.js:16`（`src="${info.video_info.variants.at(-1).url}"`）、`:27`（`src="${info.media_url_https + "?name=orig"}"`）が `mediaHTMLAt()` の戻り値として `:62`（`wrapper.innerHTML`）と `:80` の dialog `innerHTML` で解釈される。URL に `"` を含むと属性脱出。通常は X の CDN 採番だが無エスケープなのは事実。

増悪要因: `background.js` の DNR が X の CSP を除去するため、インライン実行に対する最終防御が働きにくい。

修正案:
- 属性値へ入れる前に共通の HTML/属性エスケープ（`"` `<` `>` `&`）を通す。`src` は代入前に許可スキーム（`https:`）を検証する。
- メディア表示はテンプレート文字列連結をやめ、要素生成後に `element.src = url` の DOM プロパティ代入へ寄せる（`media_viewer.js:145,148` 等は既にこの形で安全）。

対応: `extensions/custom/safe_values.js`で全カラム属性置換をescapeし、メディアは`createElement`と`src`プロパティ代入へ変更した。非HTTPS URLは表示・downloadとも拒否する。

### N-2. インポート検証がカラム文字列フィールドの文字種を見ない

確度: HTML 注入は確定
影響: 悪意ある／壊れたエクスポート JSON の取り込みで N-1 経由の stored injection

`settings_codec.js:42-48` の `validate_column` は `column_save_title` / `column_save_path` / `column_pinned_path` を「string 型か」「path は先頭 `/` か」しか検証せず、`"` `<` `>` を許容する。これらは `content.js:764` の Explore テンプレートへ属性値・iframe src として埋め込まれるため、`column_save_title` に `"/><iframe src=...>` 等を入れたプロファイルを取り込むと、復元時に注入が発火する。

修正案:
- 属性へ使う文字列は制御文字・`" < >` を拒否する。
- path 系は `/[\w\-./?=&%]*` 程度の許可パターンに正規化・検証する。
- N-1 のエスケープと二重で防御する（defense in depth）。

対応: title等は制御文字と長さを検証し、pathは`URL`で`https://x.com`同一オリジンの相対pathだけを受理する。通常の検索タイトルに含まれ得る引用符等はN-1のescapeで安全化する。

---

## 優先度: 中

### N-3. 自動更新の間隔変更が走行中タイマーへ反映されない

確度: 確定
影響: 自動更新 ON のまま秒数を変えても、次回チェックボックス再トグルまで旧間隔のまま

`content.js:1289-1299` の間隔変更（`change`）ハンドラーは `alert` と `column_settings_save` を呼ぶだけで、`start_auto_reload` を呼び直さない。前回監査 H-4 の修正案「間隔変更時は停止して新周期で再作成する」のうち、この副項目が未実装で残っている。

修正案: 有効中（チェック ON）なら `change` 時に `stop_auto_reload()`→`start_auto_reload(new_ms)` を実行する。

対応: 入力欄は通常ON時disabledだが、programmaticな`change`も含め、ON状態なら`start_auto_reload`で既存intervalを停止して新周期へ置き換える。

### N-4. `COLUMN_TYPES` に本家新型カラムが無く、正当なプロファイルを拒否する

確度: 確定
影響: `misskey`/`bsky` カラムを含む設定のインポートが全体失敗する

`content.js:942-946` は `misskey` / `bsky` カラム型を認識し（`_locales/*/messages.json:221,224` に対応メッセージあり）が、`settings_codec.js:5-13` の `COLUMN_TYPES` は 7 種のみでこれらを含まない。該当型を含むプロファイルは `validate_column`→`validate_profile_store` が false となり、`decode()` が「プロファイルまたはカラム設定の形式が不正です」で**全体を拒否**する。

補足: これらの型は `default_element`（テンプレート 6 種）に無く、現状の deck では描画されず読み飛ばされる。インポートで受理して読み飛ばすのか、明示的に非対応として個別メッセージで弾くのか、方針を決めた上で `COLUMN_TYPES` を整合させる必要がある。

修正案: 対応方針に合わせて `COLUMN_TYPES` へ `misskey`/`bsky` を追加するか、未対応型を「無視して取り込む」正規化を入れる。

保留判断: `default_element`に描画実装がなく、受理しても黙って消える方が危険である。利用予定が生じた時点で描画・保存・codec・移行testを一組で追加する。

### N-5. `mutate_url` の observer がクロスオリジン iframe で例外を投げ得る

確度: 確定
影響: Explore が外部オリジンへ遷移した瞬間に例外。その回の `column_settings_save` が実行されず設定不整合が起こり得る

`content.js:1447-1465` の `mutate_url` は try/catch 無しで `exp_object.contentWindow.location.href` / `.document.title` を参照する。X 内 iframe は通常同一オリジンで成功するが、`t.co` リダイレクト・再認証での別オリジン遷移・`about:blank` 初期状態では `SecurityError` を投げる。`watch_load_column`（`content.js` の同種処理）は try/catch 済みだが、この observer は未保護。

修正案: `contentWindow` へのアクセスを try/catch で包み、失敗時は保存をスキップして次回に委ねる。

対応: URL/title/documentの取得を`read_explore_state`へ集約し、失敗時は保存せず次回loadへ委ねる。再load時は旧observerも切断する。

---

## 優先度: 低

### N-6. `background.js` の `onMessage` に sender 検証が無い

確度: 確定（コード上）
影響: 拡張内の任意コンテキストから `text_review`（任意テキストを外部 API へ中継）・`ext_reload`（拡張再起動）・`dnr_upd` を無制限に呼べる

`background.js:10-56` は `sender` を一切見ずに処理する。`externally_connectable` 未設定のため任意 web ページからは到達しないが、content script・WAR ページ（`settings_import.html` 等）からは無制限。特に `text_review` は外部サーバー（`https://opd.kwdev-sys.com/...`）への中継、`ext_reload` は再起動を誰でも起動できる。

修正案: `sender.id === chrome.runtime.id` と、必要なら `sender.url` のオリジンを検証する。

対応: `sender.id`、request型、message種別を検証し、未知・外部senderには`false`を返して処理しない。

### N-7. 文章校正エディタの `MutationObserver` が破棄されない（要検討）

確度: 確定
影響: M-6 と同種の軽微な observer リーク

`extensions/text_review.js:149-160` は `new MutationObserver(...).observe(...)` の戻り値（undefined）を保持するだけで、observer 本体を参照・disconnect できない。`opd_text_counter` 属性で editable 要素あたり 1 回に抑えてはいるが、カラム破棄・プロファイル切替時に停止する経路が無い。

修正案: observer を変数で保持し、`lifecycle.js` の disposer に登録してカラム破棄時に disconnect する。

保留判断: observerはiframe documentに紐づき、再構築後の旧documentとともに回収されるため実害は限定的。個別対応で別の破棄経路を増やさず、column共通disposerを導入する時に統合する。

### N-8. `content_regression.test.mjs` が実行時挙動を検証していない（要検討）

確度: 確定
影響: 回帰検出力が弱く、表現変更で誤検知・別経路のバグを見逃す

`tests/content_regression.test.mjs` は `content.match(...)` / `assert.match(source, /.../)` のソース文字列 grep で、`content.js` の実行時挙動を検証していない（例: `replaceAll("%column_auto_reload_time%", "10")` の出現確認）。`tests/project_integrity.test.mjs` の workflow チェックも grep ベース。`storage_state` / `lifecycle` / `text_review` の各テストはロジックを実行して検証しており妥当なので、`content.js` 側も主要関数を抽出して実行検証へ寄せると回帰検出力が上がる。

一部対応: 属性template、URL検証、sender検証、storage失敗を独立した実行テストへ追加した。`content.js`全体のDOM実行はfixture費用が大きいため、次の責務分離に合わせて継続する。

### N-9. `settings_import.js` の `FileReader` に error ハンドラーが無い（要検討）

確度: 確定
影響: ファイル読み込み失敗（権限・破損）時に無反応

`extensions/custom/settings_import.js:44-50` は `reader.addEventListener("load", ...)` のみで `error` 未処理。`set_status` で失敗を通知すべき。出力は `textContent`/`value` 経由のため XSS は無い。

対応: `error`時に入力欄を消去し、`FileReader.error.message`があれば画面へ表示する。

### N-10. `storage_repository.update_json` が更新をサイレントに握り潰し得る（要検討）

確度: 確定（設計上の落とし穴）
影響: mutator が誤って `undefined`/`null` を返すと、エラーにならず変更前の値を書き戻し、成功コールバックが呼ばれる

`extensions/custom/storage_repository.js:184-207` の `next == null ? current : next` は、意図的な「no-op で現状維持」に見えるが、mutator の実装ミス（返し忘れ）と区別できない。現状の呼び出し側（`column_state.js` の各 mutator）は正しく値を返すため実害は無いが、将来のミスを隠す。あわせて、mutation queue は `operation` が例外も投げず `finish` も呼ばない場合に永久停止する（タイムアウト無し）点も堅牢性上の弱点。

修正案: no-op を返す場合は明示的なセンチネル（例: 専用シンボル）にし、`undefined` は開発時 warn する。queue に安全弁のタイムアウトを検討する。

対応: `undefined`は書き込み前にエラーとし、意図的なno-opは公開した`NO_CHANGE`だけで表現する。エラー後もqueueが次の更新を処理する実行テストを追加した。

---

## 問題なしと確認した主な項目（誤検知の除外）

- `profile_debug.js`: `settings_import.html` へのリダイレクトのみで、未検証 storage 書き込みは残っていない（M-3 は無害化済み）。
- `settings_import.js` の出力は全て `textContent`/`value` 経由で XSS 無し。`validate_column_state` はキーを `/^\d+:\d+$/` に制限し、`normalize` も危険キーを直接展開しないため codec 経由の prototype pollution は困難。
- `manifest.json` / `manifest_firefox.json`: permissions・host_permissions・WAR 露出はいずれも使用箇所があり過剰なし。
- `.github/workflows/*.yml`: `pull_request_target` 不使用。ユーザー入力は env 経由で `"$VAR"` 参照し `${{ }}` のシェル直展開なし。`sync-upstream` は `contents:read`+`issues:write` のみで merge/push/pr せず、`upstream-base` は 40 桁 hex と祖先関係を検証。
- `package.*` / `verify.*`: allowlist 方式で必須ファイルを列挙し、Firefox manifest の改名・許可外混入・置換前 manifest 残存を検査。抜け・不要混入なし。
- `lifecycle.js` の `observe_when_ready` / `initialize_page_observers`: observer を disconnect しないのはページ単位 1 度きり（M-6 設計）と整合。2 回目の `on_react_change(null)` は受け側 `main_dsp` が `if(!react_root) return` でガード済み。
- `storage_repository` の mutation queue は、コールバック未呼び出しシナリオ以外では `finish` の `is_finished` ガードで必ず 1 度だけ callback を呼ぶ。
- `column_history.js`: `track` 冒頭の `stacks.has(iframe)` ガードと切断時 `clearInterval`+`delete` で二重登録・リークなし。

## 要検討として残す観察（新規バグではない）

- `extensions/custom/index.js`: メイン `MutationObserver` が `document.documentElement` を `subtree:true` で監視し、X の DOM 変化ごとに全カラム走査を再実行する。各処理は属性ガードで冪等だがコスト大（パフォーマンス懸念）。
- `index.js` の `enforce_tab` 自動クリックが `watch_tab_click` の保存経路を通り、余分な `save_tab` を誘発し得る（`is_selected` ガードで通常は抑制。実 DOM 要確認）。
- `column_state.js` の `get_profile_index` は `.profile_val_now` の textContent を読むが、`copy_profile`/`delete_profile` が表示更新前に走る経路の競合可能性は実ブラウザーでの確認が要る（R-2 の安定 ID 化で根本解消する範囲）。

## 推奨対応順

1. N-1 / N-2 / N-3 / N-5 / N-6 / N-9 / N-10: 対応済み
2. N-4: 利用予定がないため保留
3. N-7: column共通disposerを導入する際に再検討
4. N-8: `content.js`から次の純粋ロジックを分離する際に実行テストへ置換
