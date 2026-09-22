# カラムタブ状態の安定ID移行設計 (BL-018)

作成日: 2026-09-22  
更新日: 2026-09-22  
状態: 手順1〜6を実装済み。手順7(位置経路と二重読みの削除)だけ残っている

## 1. 結論

カラムごとのタブ保存の鍵を、表示位置 `profile_index:column_index` から
カラム固有の安定ID `profile_index:column_uid` へ移す。

安定IDはカラム設定の一項目として本家の `opd_profile_store` に載せる(方式B)。
IDの発行・読み書きは `extensions/custom/` 側で完結させ、本家ファイルの
テンプレートには手を入れない。

プロファイル番号の部分は位置のまま残す。プロファイルは本家が配列で持つため、
番号を安定IDにすると `opd_profile_store` の構造自体を変えることになり、
移行範囲がカラム識別の問題から離れる。番号の付け替えは `copy_profile` /
`delete_profile` の2か所で既に固定済みで、今回壊れる箇所ではない。

## 2. 現状

### 保存形式

`opd_custom_column_state` は次の平坦なマップである(`extensions/custom/column_state.js:39-46`)。

```json
{ "0:0": "Following", "0:1": "For you", "1:0": "Following" }
```

鍵の左は `.profile_val_now` から読むプロファイル番号、右は**タイムライン
カラムだけを表示順に数えた添字**である(`extensions/custom/index.js:48-62`)。独自の並び替えは
DOMを動かさず flex の `order` だけを変えるため、DOM順ではなく表示順で数える。

### 位置がずれるたびに付け替えている箇所

カラムの位置が変わる操作のたびに、操作前後の `section` 要素の同一性で
対応を取り直している(`extensions/custom/column_reorder.js:179-212`)。呼び出しは本家
`content.js` の6か所である。

| 操作 | 呼び出し位置 |
| --- | --- |
| 2段目ラックの解除 | `content.js:706-709` |
| タイムラインカラム追加 | `content.js:764-766` |
| ドラッグ&ドロップ移動 | `content.js:944-950` |
| カラム削除(ピン無し) | `content.js:969-972` |
| カラム削除(ピン有り) | `content.js:976-979` |
| プロファイル追加・削除 | `content.js:802` / `content.js:828` |

### 何が問題か

- 位置は**保存の外側**にある。`remap_after_dom_change` を1か所でも呼び忘れると、
  リロード時に別カラムのタブが割り当てられる。E2E Phase 4 で実際に1件検出した
  (`index.js` が表示順ではなくDOM順で数えていた)。
- 付け替えは本家ファイルへの差分として6か所に散る。本家更新の取り込みで
  競合しやすい。
- 付け替えが走るのは「操作を検知できたとき」だけである。将来、本家が別経路で
  カラムを消す・並べ替える変更を入れると、こちらは気付けない。

安定IDにすると、カラムの追加・削除・並び替えでは**何も付け替えなくてよい**。
上の表のうち、ラック解除・追加・移動・削除の呼び出し5か所を本家ファイルから
落とせる。

## 3. 方式の比較

### 方式A: 独自ストレージに並び順リストを持つ

`opd_custom_column_ids` のような独自キーへ、プロファイルごとにカラムIDの
並びを保存し、位置↔IDの対応表として使う。

- 利点: `opd_profile_store` に触れない。本家の保存形式と完全に分離できる。
- 欠点: **対応表そのものが位置依存**である。カラムを1つ足せば対応表もずらす
  必要があり、現在 `remap_after_dom_change` が抱えている問題がそのまま
  対応表側へ移るだけになる。本家ファイルの6か所も残る。
- 欠点: プロファイル保存(`save_current_profile`)とは別のタイミングで
  書かれるため、2つの保存がずれた状態が生まれる。ずれたときに
  どちらを正とするか決められない。

### 方式B: カラム設定に安定ID欄を足す(採用)

カラム設定(`opd_profile_store[n].profile[]` の各要素)に安定IDを足す。
値はカラムのDOM要素の属性として往復させる。

- 利点: IDがカラム設定と同じ寿命・同じ書き込み経路に乗る。並び替え・追加・
  削除で `save_current_profile` が走れば、IDも一緒に正しい順で保存される。
  付け替えが要らない。
- 利点: 本家ファイルへ**コードの差分を足さない**。ID発行は
  `column_settings.render_profile` / `column_dom.add_column` の中(いずれも
  `extensions/custom/`)で行い、描画後に属性を書く。テンプレート文字列
  (`content.js:215-221`)へプレースホルダーを足す必要はない。
- 欠点: 本家の保存データに独自項目が増える。本家が同じ名前の項目を後から
  足すと衝突する。項目名は本家の `column_` 系と衝突しないよう
  `opd_custom_uid` とする。
- 欠点: 古いバージョンへ戻したとき、独自項目は本家からは無視されるだけで
  害は無いが、こちらのタブ保存は新形式のまま残る。戻す手順が要る(§6)。

方式Aの「本家データに触れない」という利点は、対応表が位置依存のままである
以上、BL-018 の目的(位置依存をやめる)を果たさない。方式Bを採る。

## 4. 移行後の形

### データ

```jsonc
// opd_profile_store[0].profile[2]
{ "type": "home", "opd_custom_uid": "k3f9x2ab" /* 既存項目はそのまま */ }

// opd_custom_column_state
{ "schema_version": 2, "tabs": { "0:k3f9x2ab": "Following" } }
```

`opd_custom_column_state` は現在、鍵と値だけの平坦なマップである。移行後の
判別を鍵の正規表現だけに頼ると脆いため、`schema_version` を持つオブジェクトへ
包み、旧形式(平坦なマップ)を version 1 とみなす。

### IDの発行

`safe_values.create_random_id` を使う。発行時にプロファイル内の既存IDと
突き合わせて衝突を避ける。発行するのは次の3経路だけである。

1. `column_dom.add_column` — 新規カラム追加時
2. `column_settings.render_profile` — 保存データにIDが無いカラムを描画するとき
3. プロファイル複製時の振り直し(後述)

### 読み書きの経路

- 書き: `column_settings.render / render_values` が `opd_custom_uid` を
  カラムのルート要素の属性へ出す。`normalize` の返り値に `opd_custom_uid` を
  加え、`read` は `getAttribute("opd_custom_uid")` で読み戻す。
  これで `read_profile → save_current_profile` の既存経路にそのまま乗る。
- 読み: `index.js` の `current_column_index(iframe)` を
  `current_column_uid(iframe)` へ置き換える。カラム要素から属性を読むだけに
  なり、表示順を数える処理(`get_timeline_columns` の順序依存)が
  タブ保存の経路から消える。

### プロファイル複製

新しいプロファイルは現在のDOMを読んで作られる(`content.js:797-798`)ため、
そのままでは複製元とIDが重複する。鍵にプロファイル番号を残すので保存は
分かれるが、複製後にどちらかのカラムを消すとIDの意味がずれるため、
複製時にIDを振り直す。

既存の `copy_profile` は鍵の接頭辞を付け替えるだけなので、振り直したIDの
対応表を受け取る形へ変える。振り直しは複製したカラム設定配列に対して行い、
`opd_profile_store` と `opd_custom_column_state` を同じ書き込みで保存する。

### プロファイル削除

`delete_profile` の番号詰めはそのまま使える。変更しない。

## 5. 旧データの移行

### 実行タイミング

デッキの `run()` がカラムを描画する**前**に1回だけ走らせる。描画後に走らせると、
移行前の鍵でタブ復元が始まり、移行後の保存と競合する。

### 手順

移行はDOMを見ない。`opd_profile_store` と `opd_custom_column_state` の
2つの保存値だけで完結する純粋な変換とし、Nodeテストで固定する。

1. `opd_custom_column_state` が `schema_version: 2` なら何もしない(冪等)。
2. `opd_profile_store` の全プロファイル・全カラム設定を走査し、
   `opd_custom_uid` が無いものへIDを発行する。IDはプロファイル内で一意にする。
3. 旧鍵 `p:c` を、プロファイル `p` の**タイムラインカラムだけを配列順に
   数えた c 番目**のIDへ読み替える。数え方は `get_timeline_columns` と
   同じ(`type === "home"` だけを数える)。
4. 対応するカラムが無い旧鍵は捨てる(削除済みカラムの残骸)。
5. `{schema_version: 2, tabs: {...}}` として書き、同じ書き込みで
   `opd_profile_store` も保存する。

### 原子性

`storage_repository` には複数キーの read-modify-write が無い。
`get_json_many` と `set_json_many` は別々のキュー項目になるため、
その間に他の書き込みが入ると片方を取りこぼす。移行のために
`update_json_many(defaults, mutator, callback)` を足し、1つのキュー項目の中で
両キーを読んで書く。移行以外の用途にも使えるため、`storage_repository` の
API として追加する。

### import / export

- `settings_codec.SCHEMA_VERSION` を 2 へ上げる。
- `decode` は schema_version 1 と 2 の両方を受ける。1 を読んだ場合は
  §5 の手順と同じ変換を通してから返す。変換関数は移行と共有する。
- `validate_column_state` の鍵の正規表現 `^\d+:\d+$` を
  `^\d+:[0-9A-Za-z_-]+$` へ広げ、`schema_version` / `tabs` の形も検証する。
- `normalize_column` は既知項目だけを写すため、`opd_custom_uid` を
  写す項目へ足す。足さないと import で全カラムのIDが消える。
- export は常に version 2 で書く。

## 6. 失敗時の戻し方

### 移行が失敗した場合

移行は「変換して書く」1手である。変換中に例外が出た場合は**何も書かず**、
旧形式のまま起動する。このとき位置キーの経路で動く必要があるため、
移行を入れる版では新旧どちらの鍵でも読める状態を保つ。

- 読み: `get_tab` は `schema_version` を見て、2 ならID、1なら位置で引く。
- 書き: 移行が成功した後だけID経路で書く。失敗した起動では位置経路で書く。

この二重経路は移行を入れた版だけの措置とし、次の版で位置経路を落とす。
落とす条件は「移行の Node テストと E2E が通り、実ブラウザーで1度
デッキを起動してタブ復元を確認していること」とする。

### 版を戻す場合

移行時に旧値を `opd_custom_column_state_v1` へそのまま残す。古い版へ戻すと、
その版は `opd_custom_column_state` を平坦なマップとして読み、`schema_version` と
`tabs` を鍵として扱う。どのカラムにも一致しないため、タブ保存が全部消えたのと
同じ状態になる。壊れはしないが復元しなくなる。

このため、版を戻す手順は次のとおりとする。

1. 設定のエクスポートを取る(新形式)。
2. 古い版へ戻す。
3. `opd_custom_column_state_v1` を `opd_custom_column_state` へコピーする。

3 を手で行う必要があるため、`opd_custom_column_state_v1` は移行が1度成功した
後は書き換えない。

## 7. 検証計画

`verificationRequired` は `code` のままとする。以下がすべて通ることを
BL-018 の検証とする。

### Node テスト(新規)

- 移行関数: version 1 の実データ形状を version 2 へ変換する。
  - タイムライン以外のカラム(`notification` / `explore` / `empty_column`)を
    挟んだプロファイルで、`p:c` の c がタイムラインだけの連番として
    読み替えられる。
  - カラム数より大きい添字の旧鍵が捨てられる。
  - 2回流しても結果が変わらない(冪等)。
  - `opd_profile_store` が空・欠損でも例外を投げず、旧値を保持する。
- `column_state`: ID鍵での `get_tab` / `save_tab` / `copy_profile`(振り直し
  付き)/ `delete_profile`。
- `column_settings`: `normalize` / `render` / `read` の `opd_custom_uid`
  round-trip。IDの無い保存データを描画するとIDが発行される。
- `settings_codec`: version 1 のエクスポートファイルを import して
  version 2 になる。version 2 の round-trip。`opd_custom_uid` が
  import で落ちない。
- `storage_repository`: `update_json_many` が2キーを1回の書き込みで
  更新し、間に割り込んだ書き込みを失わない。

### E2E(既存シナリオの拡張)

- タブ復元シナリオを、並び替え**後**にリロードして確認する形へ拡張する。
  現在は並び替え時の付け替えを見ているが、移行後は付け替え自体が無くなる。
- カラム削除後に残ったカラムのタブが保持されることを確認する。

### 手動確認

実ブラウザーでの起動確認は、§6 の「位置経路を落とす条件」として行う。
BL-018 を verified にする条件には含めない。

### 実施結果(2026-09-22)

- Node テスト: `tests/column_state_migration.test.mjs` を追加。移行の読み替え・冪等性・
  profile_store 欠損・ID重複・複製時の振り直し・移行失敗時に何も書かないことを固定した。
  `tests/storage_state.test.mjs` に `update_json_many` と version 2 の import/export を足した。
  `tests/column_reorder.test.mjs` を追加し、安定ID運用中は付け替えが走らないことを固定した。
  `node tests/run.mjs` は 163 件通る。
- E2E: `tests/e2e/tab-restore.spec.mjs` を、並び替え後のリロード・カラム削除・
  version 1 の保存からの移行の3本へ広げた。`npx playwright test` は 10 件通る。

## 8. 実装順

1. `storage_repository.update_json_many` を足す(単独でマージできる)。
2. `column_settings` に `opd_custom_uid` を通す。この時点では誰も読まない。
3. 移行関数を純粋関数として足し、Nodeテストで固定する。まだ呼ばない。
4. `run()` の入口で移行を呼び、`column_state` を新旧両対応にする。
5. `index.js` をID経路へ切り替える。`content.js` の付け替え呼び出し5か所を
   落とす(プロファイル複製・削除の2か所は残す)。
6. `settings_codec` を version 2 へ上げる。
7. 実ブラウザーで1度確認した後、位置経路と二重読みを落とす。

1〜3 は保存データを変えないため、いつでも戻せる。4 以降を1つのコミットに
混ぜない。

### 実装した内容(2026-09-22)

手順1〜6を実装した。ファイルは次のとおり。

| 手順 | 実装 |
| --- | --- |
| 1 | `storage_repository.update_json_many` |
| 2 | `column_settings` の `opd_custom_uid`(normalize / render / read)、`column_dom.add_column` の発行 |
| 3 | `extensions/custom/column_state_migration.js`(純粋関数。ID発行と移行) |
| 4 | `column_state.ensure_migrated` / `when_ready` / `column_key`、`content.js` の `ensure_column_state_migrated` |
| 5 | `index.js` の `current_column_key` |
| 6 | `settings_codec` の version 2 |

#### 設計からの変更: 手順5の呼び出し削除を手順7へ送る

設計では手順5で `content.js` の付け替え呼び出し5か所を落とすとしていたが、落とさなかった。

§6 の通り、移行に失敗した起動は位置キーのまま動く。その起動では付け替えが要るため、
呼び出しを先に落とすと失敗時に並び替えでタブ保存が壊れる。代わりに
`column_reorder.remap_tab_state` の先頭で `column_state.is_stable_id_mode()` を見て、
安定ID運用中は何もしないようにした。付け替えが走らないという結果は同じで、
`content.js` への差分も増えない。

呼び出し5か所は、位置経路と二重読みを落とす手順7で一緒に落とす。

### 実装で決めた未決事項(§9)

- 項目名は `opd_custom_uid` とした。本家がカラム設定に項目を足したときに衝突しないことを優先した。
- IDの長さは `create_random_id` の出力そのまま(base32で10〜11文字)とした。
  1プロファイルのカラム数はせいぜい数十で、保存サイズは問題にならない。
- 手順7の時期は実ブラウザー確認の予定次第。BL-018 の検証条件には含めない(§7)。

## 9. 未決事項

- 項目名を `opd_custom_uid` とするか、より短い名前にするか。本家が
  カラム設定に項目を足す可能性を考えると接頭辞付きが安全だが、
  `opd_profile_store` は元々 Open-Deck のデータであり、接頭辞は冗長でもある。
- ID の文字数。`create_random_id` の現在の出力長をそのまま使うか、
  保存サイズを見て短くするか。
- 手順 7 をいつ行うか。実ブラウザー確認の予定が立っていないため、
  二重経路が長く残る可能性がある。

## 関連

- 残課題: BL-018(`docs/backlog/report.md`)
- 元の指摘: `docs/archive/code-audit-2026-09-11.md` R-9
- E2E 基盤: `docs/browser-e2e-test-design.md`
