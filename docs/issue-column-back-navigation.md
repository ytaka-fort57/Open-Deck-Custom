# カラム内の「戻る」が効かない / 戻ると先頭までスクロールする

記録日: 2026-08-25
状態: コード修正済み。実機確認は「戻れない」側のみ完了
対象: Open-Deck Custom（本家 Release `aae4fdb` 相当）

## 前提: iframeの戻るはフレームを選べない

各カラムは同一オリジンのiframeである。`history.back()` はフレーム単位ではなく
**joint session history**（全フレーム共通の1本の履歴列）を1つ戻すため、戻る対象は
「押したカラム」ではなく「直近に遷移したフレーム」になる。フレームを指定して戻る
標準APIは存在しない。

このためカスタム版は、カラムごとのURL履歴を自前で持ち、Backspaceでそのカラムだけを
前のURLへ戻す（`extensions/custom/column_history.js`）。X標準のapp-bar戻るボタンは
標準ルーターへ処理を返している（`ee226f0`）。

## 症状

1. Backspaceでリプライ詳細から本体ポストへ戻れない。URLだけ変わって描画が変わらない
2. 戻った後にタイムラインが先頭までスクロールする。毎回ではない

いずれも本家では発生しない。どちらも `a5e0679` で入った変更が引き金だった。

## 原因1: 戻る先ではなく「今いる画面」のrouter stateを渡していた

Xのルーターは `popstate` で **URLではなく `history.state` のkey / idx** を見て、
どのエントリを描画するかを決める。`back()` は次のように書かれていた。

```js
const current_state = column_window.history.state;          // リプライ詳細のstate
column_window.history.replaceState(current_state, "", target_url);  // URLだけ本体へ
column_window.dispatchEvent(new column_window.PopStateEvent("popstate", {state: current_state}));
```

同じstateを渡すとXは「同じエントリ」と判断して再描画を行わず、URLだけが本体ポストに
なる。初版（`69cb846`）は `null` を渡しており、`a5e0679` でこの形に変わっていた。

### 修正

URL監視のたびに `history.state` も一緒に控え、戻る際は**戻り先を記録した時点のstate**へ
復元する。控えが取れない場合だけ `null`（新しいエントリ扱い）にフォールバックする。
スタックの要素は `{url, route_state}` である。

## 原因2: スクロール抑止を標準動作へ委ねていた

`extensions/auto_reload_helper.js` は `scrollIntoView` と `focus` をパッチして、
Xによる自動スクロールを握り潰す。`a5e0679` は「通常時は標準動作を保持する」意図で
2箇所を標準動作へ戻していた。

```js
- if (!parent) return;                                  // 本家
+ if (!parent){ return originalScrollIntoView.call(this, options); }

- return originalFocus.call(this, Object.assign({}, options, { preventScroll: true }));  // 本家
+ return originalFocus.call(this, options);
```

戻る直後、Xは復元した記事へ `focus()` / `scrollIntoView()` をかける。上の変更により
その動作が素通りし、タイムラインが先頭へ飛ぶ。スクロール親の探索結果は描画タイミング
依存のため「毎回ではない」条件と一致する。

このヘルパーは**自動更新の設定と無関係に** home / explore の全カラムへ注入される
（`content.js` の `reinit_column_extensions`）ため、自動更新を使っていなくても影響する。

### 修正

2箇所とも本家の挙動（`if (!parent) return;` と `preventScroll: true` の強制）へ戻した。

## 原因3以降: 上記の修正後に洗い出した3件

いずれも「戻る」を壊す方向に効くため、続けて修正した。

### 3. 戻るの成否判定が常に成功していた

`pending_back` は「監視中のURLが目的地と一致したか」で成否を決めていたが、そのURLは
`back()` 自身が `replaceState` で書き込んだ値なので、Xが何も描画しなくても必ず一致する。
結果、戻れていないのに履歴が切り詰められ、次のBackspaceが1つ飛ばしになっていた。
さらに時間切れ時は `state.stack = [現在URL]` と履歴を捨てており、そのカラムで以後
戻れなくなっていた。

修正:

- 描画されたかを `document.title`、`primaryColumn` の `aria-label`、先頭記事の
  status リンクから作る手掛かり(`render_signal`)で判定する。URL一致だけでは確定しない
- 手掛かりを読めない場合は判定できないため、従来どおりURL一致で進める
- URLは目的地だが描画が変わらないまま時間切れになった場合は、URLだけ元へ戻す
  (`rollback`)。描画は動いていないので `popstate` は流さない。履歴は残すため、
  次のBackspaceが retry になる
- Xが別のURLへ動いた場合は、履歴を捨てずに現在URLへ繋ぎ直す(`resync`)

### 4. タブ復元の自動遷移がjoint session historyを奪っていた

`enforce_tab` は読み込み後20秒間、保存したタブを押し直す。ピン留めしたリストのタブは
別URLへのリンクのため、押すとそのカラムが遷移し、joint session historyへエントリが
積まれる。すると「直近に遷移したフレーム」がユーザーの操作していないカラムになり、
X標準の戻るが別のカラムを動かす。

修正: `selectors.navigates()` で遷移を伴うタブを見分け、復元のための遷移は
1カラムにつき1回までとする(`restore_tab`)。遷移を伴わない「おすすめ / フォロー中」の
選び直しは、Xによる上書きへ対抗するため従来どおり続ける。ユーザー自身のタブ操作は
`watch_tab_click` が拾うだけで、この制限の対象外である。

### 5. カラム移動後に追跡が復活しなかった

`track()` は `iframe.isConnected` が false になると interval を解除して `stacks` から
削除するが、`index.js` の `KEYS_ATTR` は要素に残るため `track()` が二度と呼ばれない。
ラックをまたぐカラム移動はDOM移動を伴う（同一ラック内はCSS orderのみで移動しない）ため、
移動したカラムのBackspaceが以後効かなくなっていた。

修正: `column_history.track()` を `KEYS_ATTR` のガードより前へ移す。`track()` は追跡中なら
何もしないため、毎回呼んでも二重に監視しない。

## 今後の変更で守る条件

- `column_history.back()` に**現在の `history.state` を渡さない**。渡すのは戻り先を
  記録した時点のstate、または `null`。
- `auto_reload_helper.js` の `scrollIntoView` / `focus` パッチから**標準動作への委譲を
  増やさない**。スクロール親が無い場合は何もしないのが正しい。
- `column_history` のスタック要素は `{url, route_state}` である。URL文字列として
  比較・検索しない（`last_index_of_url` を使う）。
- X標準のapp-bar戻るボタンをフックし直さない。カラム分離はBackspaceだけが担当する。
- 戻るの成否を**自分が書き換えたURLだけで判定しない**。描画の手掛かりと併せて見る。
- 戻れなかった場合に履歴を捨てない。捨てるとそのカラムで以後戻れなくなる。
- タブ復元など**自動処理でカラムを遷移させる回数を増やさない**。joint session history
  の「直近に遷移したフレーム」を奪い、ユーザーが操作中のカラムの戻るを壊す。
- `column_history.track()` を `KEYS_ATTR` のような一度きりのガードで囲わない。

## 回帰テスト

- `tests/column_history.test.mjs`
  「back restores the history state recorded for the target URL」…
  リプライ詳細から戻った際に親側のstateが復元されることを固定する
- `tests/content_regression.test.mjs`
  「auto reload helper keeps X from scrolling the timeline to the top」…
  スクロール抑止が標準動作へ戻されないことを固定する
- `tests/column_history.test.mjs`
  Xが無視した場合のURL巻き戻しと履歴保持、別URLへ動いた場合の繋ぎ直し、
  描画が変わって初めて確定することを固定する
- `tests/column_tab_restore.test.mjs`
  遷移を伴うタブの判定、復元の遷移が1回までであること、
  `track()` が `KEYS_ATTR` に囲われていないことを固定する

## 未確認 / 既知の弱点

- 症状2（先頭スクロール）は発生条件が不定のため、実機での解消を確定できていない。
- `render_signal` は描画の手掛かりであって証明ではない。戻る前後で
  `document.title`・`aria-label`・先頭記事がすべて同じ画面では、戻れているのに
  時間切れ扱いとなり、URLだけ巻き戻る。実害は「URLが1つ前のまま残る」ことで、
  履歴は保つため次の操作は続けられる。
- 原因4の制限により、ピン留めリストのタブをXが繰り返し上書きするカラムでは、
  2回目以降の復元が行われない。実機でそのような上書きが起きるかは未確認。
