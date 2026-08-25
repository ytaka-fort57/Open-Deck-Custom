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

## 今後の変更で守る条件

- `column_history.back()` に**現在の `history.state` を渡さない**。渡すのは戻り先を
  記録した時点のstate、または `null`。
- `auto_reload_helper.js` の `scrollIntoView` / `focus` パッチから**標準動作への委譲を
  増やさない**。スクロール親が無い場合は何もしないのが正しい。
- `column_history` のスタック要素は `{url, route_state}` である。URL文字列として
  比較・検索しない（`last_index_of_url` を使う）。
- X標準のapp-bar戻るボタンをフックし直さない。カラム分離はBackspaceだけが担当する。

## 回帰テスト

- `tests/column_history.test.mjs`
  「back restores the history state recorded for the target URL」…
  リプライ詳細から戻った際に親側のstateが復元されることを固定する
- `tests/content_regression.test.mjs`
  「auto reload helper keeps X from scrolling the timeline to the top」…
  スクロール抑止が標準動作へ戻されないことを固定する

## 未確認 / 既知の弱点

- 症状2（先頭スクロール）は発生条件が不定のため、実機での解消を確定できていない。
- `back()` の成否判定（`pending_back`）は、自分で `replaceState` したURLと突き合わせて
  いるため、Xが描画しなくても成功扱いになる。実際の描画変化を見る方式へ作り直す余地がある。
- `enforce_tab` の自動タブクリック（読み込み後20秒間）は、ピン留めリストのタブを押した
  場合にjoint session historyへエントリを積み、「直近に遷移したフレーム」を奪う。
- ラックをまたぐカラム移動でiframeが切断されると `track()` のintervalが解除されるが、
  `index.js` の `KEYS_ATTR` が残るため再追跡されず、そのカラムのBackspaceが復活しない。
