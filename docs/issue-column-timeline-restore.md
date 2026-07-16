# リロード時にカラムのタイムライン選択が復元されない

記録日: 2026-07-17
対象: Open-Deck v1.1.3.7（本家 Release `aae4fdb` 相当）

## 症状

X のタイムラインは、カラム上部のタブ（おすすめ／フォロー中／ピン止めしたリスト）で切り替える。
Timeline カラムを複数開いて別々のタブを選択していても、ページをリロードすると
各カラムの選択が保持されず、どれか1つの選択状態に引きずられて全カラムが読み込まれる。

理想は XPro のデッキと同様に、リロード後も各カラムがリロード前のタブを表示し続けること。

## 調査結果

### カラムの実装

各カラムは同一オリジンの iframe である（[content.js:780](../content.js:780)）。
Timeline カラムの `src` は `https://x.com/home` 固定で、タブ情報を含まない。

```text
home         → https://x.com/home        固定
notification → https://x.com/notifications 固定
explore      → https://x.com%column_save_path%   ← パスを保存し復元している
post         → https://x.com/intent/tweet 固定
```

### 保存される値

`column_settings_save()`（[content.js:1766](../content.js:1766)）が DOM 属性からカラム設定を組み立て、
`opd_profile_store` へ保存する。保存されるのは次の項目のみ。

- `type` / `banner` / `top_visible` / `tw_view_mode`（表示フィルター）
- `column_width` / `auto_reload` / `auto_reload_time`
- `column_save_path` / `column_save_title` / `column_pinned_path` … **explore カラムのみ**

Timeline カラムにはパスに相当する保存項目がなく、タブ選択を保持する仕組みが存在しない。

### 原因

タブ選択は Open-Deck 側ではなく X 側が保持している。
すべてのカラムは同一オリジンの iframe であり、X のタブ状態はアカウント単位で共有される。
そのため最後に切り替えたタブが全 iframe の初期表示となり、リロード時に「どれか1つ」に揃う。

Open-Deck が各カラムのタブを保存していないことが直接の原因であり、
X 側の仕様（タブが URL で表現されない）がそれを埋められない理由になっている。

## 対応方針

カラムごとの選択タブを独自に保存し、iframe のロード完了後に該当タブを再選択する。
本家の保存項目には手を入れず、`opd_custom_column_state` として独自キーに保存する。

なお、リストのタブは `/i/lists/<id>` という URL を持つため、
Explore カラムとして開けば本家の既存機能だけでも復元できる（おすすめ／フォロー中は不可）。

## 未確認事項

- 現行 X のタブ要素の DOM 構造（`role="tab"` の実体、ラベルの持ち方）
- 通常リロードと `Ctrl+Shift+R` で挙動差があるか
- タブ再選択が X 側の共有状態を書き換え、他カラムへ影響しないか

## 併せて発見した別不具合

プロファイル自動復旧の経路（[content.js:156](../content.js:156)、[content.js:179](../content.js:179)）が壊れている。

- `window.reload()` は存在しない API。他所では `location.reload()` を使用（[content.js:1532](../content.js:1532)）
- 復旧の `if` ブロックに `return` がなく、非同期の `set` コールバックを待たずに
  直後の `profile_store[last_load_profile].profile` を参照して例外になる

`profile_store[last_load_profile]` が欠けている場合、復旧されずデッキが描画されないまま止まる。
本件とは別事象のため、別ブランチで対応する。
