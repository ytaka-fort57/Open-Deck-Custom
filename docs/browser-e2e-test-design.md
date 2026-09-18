# Open-Deck Custom ブラウザーE2E基盤設計

作成日: 2026-09-18  
状態: Phase 1・2・4実装済み。Phase 3(CI)は未実施

## 1. 結論

`content.js`全体の初期化、カラム追加・削除・並び替え、保存・再構築を検証するため、
Playwright同梱Chromiumで未パッケージ拡張を読み込む小規模なE2E基盤を追加する。

実Xや個人のログインプロファイルには依存しない。ブラウザーから見えるURLは
`https://x.com/...`のまま、Playwrightのrequest routingでレスポンスをローカルfixtureへ
差し替える。これにより、manifestのmatch条件と本番のURL判定を通しつつ、ネットワーク、
ログイン状態、Xの継続的なDOM変更からテストを分離する。

既存のNode回帰テストは維持し、E2Eで置き換えない。E2Eはユーザーから観測できる振る舞いと
実DOM・iframeの保持を検証し、内部関数の分岐やresource dispose順はNodeテストで固定する。

## 2. 背景

現在のNodeテストは、設定の正規化・描画境界、storage、履歴状態、lifecycle、カラムDOM操作を
高速に検証している。一方、次は未検証である。

- `content.js`の`run()`が生成した実DOMへの設定反映
- click / drag-and-drop / closeイベントの接続
- `style.order`変更後の保存順
- 並び替え時にiframe documentが維持されること
- 保存したプロファイルを使った全体再構築のround-trip

Node標準機能だけでこれらを再現すると、HTML parser、selector、event、iframe、loadを手製で
模倣する必要がある。そのfixture自体がブラウザーとの差分を持つため、実DOM検証としては採用しない。

Chromeは拡張機能について単体テストに加えてE2Eテストを推奨している。Playwrightの拡張機能
テストはpersistent browser contextと同梱Chromiumを利用する。

- Chrome: https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing
- Playwright: https://playwright.dev/docs/chrome-extensions
- Playwright browser管理: https://playwright.dev/docs/browsers

## 3. 目的

1. R-8の「`content.js`全体を実DOMで実行するfixture」を作る。
2. R-2の「設定保存から再構築までの全体round-trip」を検証する。
3. R-1、R-3、R-4の段階的リファクタに対する回帰防止網として再利用する。
4. ローカルとCIで同じ決定的シナリオを実行できるようにする。
5. 失敗時にtrace、screenshot、consoleを残し、DOM回帰の原因を追えるようにする。

## 4. 対象外

- ログイン済みXの現行React DOM / React propsの完全再現
- XのGraphQL、通知、rate limit、実メディア配信
- 個人のChrome / Edgeプロファイルやcookieの利用
- Firefox Manifest V2の自動化
- 戻る操作における実Xのjoint session historyの完全保証
- 文章校正APIの実通信

これらは[verification.md](verification.md)の実ブラウザー確認として残す。

## 5. テスト層

| 層 | 実行方法 | 主な責務 | ネットワーク |
| --- | --- | --- | --- |
| Node回帰 | `node tests/run.mjs` | 純粋関数、storage、履歴状態、dispose順、codec、安全値 | 不使用 |
| 決定的E2E | `npm run test:e2e` | 実DOM、イベント配線、iframe保持、保存・再構築 | fixture以外を遮断 |
| 実Xスモーク | 手動 | 現行X DOM、ログイン、React props、実履歴 | 実Xを使用 |

決定的E2Eが実Xスモークを置き換えたとは扱わない。

## 6. 全体構成

```text
Playwright test
  ├─ 一時user-data-dirでChromium persistent contextを起動
  ├─ リポジトリルートを未パッケージ拡張として読み込む
  ├─ extension IDをservice worker URLから取得
  ├─ extension pageからchrome.storage.localへfixtureを投入
  ├─ https://x.com/** をローカルHTML fixtureでfulfill
  ├─ https://x.com/run-opdeck を開く
  └─ UI操作とstorageの結果を検証
```

### 6.1 ブラウザー

- `package.json`は`private: true`とし、`@playwright/test`を正確なversionでdevDependencyに固定する。
- Playwright同梱Chromiumだけをインストールする。
- `launchPersistentContext()`を使用する。
- `--disable-extensions-except=<repo>`と`--load-extension=<repo>`で読み込む。
- headlessではPlaywrightの`chromium` channelを使用する。
- user-data-dirはテストごとに一時ディレクトリを作成し、個人プロファイルを使用しない。

初期基盤はリファクタ中のfeedbackを速くするため、作業ツリーのリポジトリルートを読み込む。
Chromeはmanifestが参照したファイルだけを実行し、E2E fixtureをproduction manifestへ登録しない。
配布物への混入は従来どおり`verify.ps1` / `verify.sh`のZIP許可リストで防ぐ。配布ZIPそのものの
起動確認が必要になった場合は、生成済みChromium ZIPを一時ディレクトリへ展開するartifact modeを
別シナリオとして追加し、source modeと暗黙に切り替えない。

Google Chrome / Microsoft Edge本体は拡張機能side-load用フラグの前提が変わり得るため、
決定的テストの標準ブラウザーにはしない。実ブラウザー確認でのみ使用する。

### 6.2 Xレスポンスのfixture化

browser contextへ、ページ作成・navigationより先にrouteを登録する。
navigation requestかつ既知pathだけをfulfillし、同じoriginでも未登録pathを暗黙に成功させない。

| URL | fixtureの役割 |
| --- | --- |
| `/run-opdeck` | `react-root`を持つdeck起動ページ |
| `/home` | タイムライン、タブ、投稿を持つhome iframe |
| `/notifications` | 通知iframe |
| `/explore` | Explore iframe |
| `/i/lists/<id>` | リスト、引用メディア用iframe |

メディアビューアーが実際に読み込むURLだけ、`pbs.twimg.com`の既知pathを画像として
fulfillする。それ以外の外部通信は従来どおりabortする。

fixtureはテストに必要な`data-testid`、タブ、投稿、タイトルだけを持つ。XのDOM全体を模倣しない。
未登録のx.com URLと、テストで許可していない外部通信はabortし、意図しない実通信を失敗として扱う。

`https://x.com/run-opdeck`というoriginとURLを維持するため、production manifestや
`content.js`へlocalhost用の分岐を追加しない。

### 6.3 storage投入と確認

1. persistent context起動後、Manifest V3 service workerを待つ。
2. worker URLのhost部分からextension IDを取得する。
3. `chrome-extension://<id>/profile_debug.html`を開く。
4. `chrome.storage.local.set()`で次をJSON文字列として投入する。
   - `opd_settings`
   - `opd_profile_store`
   - 必要な場合のみ`opd_custom_column_state`
5. 操作後も同じextension pageからstorageを読み、保存結果を確認する。

extension内部のクロージャやグローバル変数をE2Eから直接参照しない。
Manifest V3 workerは停止・再開し得るため、初回取得したworkerが常時生存する前提も置かない。
storage helperは必要に応じてworkerまたはextension pageを取り直せる境界へ閉じ込める。

## 7. 最初のシナリオ

最初は1本のgolden pathに限定する。テスト間の順序依存は作らず、1シナリオ内で次を行う。

### 7.1 初期化

初期プロファイルに次を保存する。

- `main_bar_empty_column`
- home: 幅32、banner有効、top表示、表示モード1、自動更新15秒
- explore: `/i/lists/42`、タイトル、幅34
- `empty_column`

`/run-opdeck`を開き、deck root、ラック、home / explore、各control値、iframe URLを確認する。
ランダムなcolumn IDそのものは固定値としてassertしない。

### 7.2 カラム追加

通知カラム追加ボタンをclickする。

- placeholderより前へ追加される
- 通知iframeのURLが正しい
- 保存済みprofileへ通知カラムが1件追加される
- 既存home / explore iframeが接続されたままである

### 7.3 同一ラック内の並び替え

独自の左右ボタンまたは表示順selectを使ってhomeとexploreの表示順を変更する。
低水準のDragEvent生成は初期シナリオでは使用しない。

- sectionの物理DOM順を変更せず、`style.order`だけが変わる
- 保存profileは表示順になる
- 並び替え前にiframe内へ置いたinstance markerが残る
- iframe URLとframeの実行contextが再生成されていない
- fixture側で記録したiframe navigation回数が増えていない

cross-rackのDOM移動は別シナリオとして後から追加する。

### 7.4 削除

追加した通知カラムのcloseボタンをclickする。

- カラムとiframeがDOMから消える
- 保存profileから通知カラムが消える
- 他のiframe markerは維持される

resource disposeがDOM削除より先であること自体は既存Nodeテストで検証し、E2Eで内部hookを追加しない。

### 7.5 保存・再構築

操作後の`opd_profile_store`を読み、同じprofileでdeckを再構築する。

- カラム型、表示順、幅、path、control値が再現される
- 再構築後にDOMから読み取れる設定が保存済み設定と一致する
- 旧iframeのmarkerが消え、新しいiframeだけが存在する
- consoleに未処理例外がない

## 8. 提案ディレクトリ

```text
package.json
package-lock.json
playwright.config.mjs
tests/
  e2e/
    fixtures/
      deck.mjs
      extension-context.mjs
      storage-fixtures.mjs
      x-routes.mjs
    pages/
      run-opdeck.html
      home.html
      notifications.html
      explore.html
      list.html
      x-router.js
      x-media-props.js
    open-deck-profile.spec.mjs
    column-cross-rack.spec.mjs
    column-back.spec.mjs
    profile-switch.spec.mjs
    tab-restore.spec.mjs
    media-viewer.spec.mjs
```

テスト生成物はGit管理しない。

```text
node_modules/
playwright-report/
test-results/
.playwright-profile/
```

## 9. コマンド案

```json
{
  "scripts": {
    "test:unit": "node tests/run.mjs",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "playwright test --debug"
  }
}
```

初回セットアップはChromiumだけを取得する。

```powershell
npm install
npx playwright install --no-shell chromium
```

ブラウザーバイナリをリポジトリへcommitしない。

## 10. Playwright設定方針

- workers: 初期は`1`
- retries: ローカル`0`、CI`1`
- `forbidOnly: true`
- timeout: 1シナリオ30秒を上限
- trace: 最初のretryまたは失敗時に保持
- screenshot: 失敗時のみ
- video: 初期は無効。必要になった時だけ有効化
- locale: `ja-JP`
- timezone: `Asia/Tokyo`
- viewport: 固定値
- webServer: 使用しない。HTMLはroute fulfillで供給する

並列化は、各テストが独立したuser-data-dirを確実に持つことを確認した後に検討する。

## 11. productionコードとの境界

次を禁止する。

- `content.js`へ`if (e2e)`のようなテスト専用分岐を追加する
- production manifestへlocalhost権限を追加する
- テストのために待機時間やretry回数を本番コードで変更する
- 個人のbrowser profile、cookie、token、Xアカウントをfixtureへ保存する
- E2Eから内部変数へアクセスするための公開APIを追加する

テストが必要とする状態はstorageとfixture HTMLから与え、結果はDOM、URL、storage、consoleから観測する。

## 12. 安定性対策

- 固定時間の`waitForTimeout()`を原則使わず、locator、URL、storage値を待つ。
- service worker、content script、iframe loadをそれぞれ明示的に待つ。
- console errorとpage errorを収集し、許可リスト外は失敗にする。
- service workerのconsole errorも収集する。
- fixture外のHTTP(S) requestを記録し、予期しない通信を失敗にする。
- random IDや実行時刻の完全一致をassertしない。
- test failure時もcontextをcloseし、一時user-data-dirを回収する。
- 同じテストを連続5回実行してflakyでないことを導入条件にする。

## 13. 導入段階

### Phase 1: 起動spike

- packageとPlaywright設定を追加
- Chromiumで拡張機能を読み込む
- service workerとextension IDを取得
- storageを投入
- fixture版`/run-opdeck`にdeck rootが出ることだけを確認

この段階では既存`verify.ps1`やGitHub Actionsへ組み込まない。

### Phase 2: golden path

- 初期化、追加、並び替え、削除、保存・再構築を実装
- traceとconsole収集を追加
- 5回連続成功を確認
- [verification.md](verification.md)へ実行手順を追加

### Phase 3: CI

- GitHub ActionsでChromiumをcacheせず、`npx playwright install --with-deps chromium`を使う
- Node回帰とE2Eを別jobにする
- E2E失敗時にtrace / screenshotをartifact化する
- 安定後もRelease packagingの必須検証とは分離する

### Phase 4: 拡張（実装済み）

golden pathとは別のspecとして追加した。実X依存のシナリオは通常CIへ入れない。

| 項目 | spec | 補足 |
| --- | --- | --- |
| cross-rack移動 | `column-cross-rack.spec.mjs` | 2段表示の追加、`DragEvent`で本家のdropハンドラーへ乗せる。ラックをまたぐ移動はDOM移動を伴い、そのカラムのiframeだけが作り直される点も仕様として固定した |
| プロファイル切替 | `profile-switch.spec.mjs` | 切替後の再構築、`last_load_profile`保存、切替元プロファイルの保存が壊れないこと |
| 戻る / Backspace | `column-back.spec.mjs` | fixtureへ最小のルーターを置き、`pushState`とpopstate描画を再現する |
| タブ復元 | `tab-restore.spec.mjs` | タイムラインカラム2本で、保存鍵の付け替えまで確認する |
| 引用メディア選択 | `media-viewer.spec.mjs` | props形状の選び方はNodeテストで固定済みのため、注入・token・ビューアー表示・キー操作の経路を見る |

fixtureのHTMLは`<!--opd-script:名前.js-->`を`tests/e2e/pages/`の同名スクリプトへ差し替えて組み立てる。
ルーターとReact props相当の値はそこへ置き、HTML側にはE2Eが参照する要素だけを残す。

#### 待ちの扱い

`column_history.js`はiframeのURLを`WATCH_INTERVAL_MS`周期で見て履歴を積む。
この状態はDOM・URL・storageのどこにも現れず、§11により観測用のAPIも追加しない。
そのため次の2点だけは時間に依存する。

- カラムの現在地が1度も記録される前に遷移させないよう、監視周期分だけ待つ
- 戻る操作は、戻れるようになるまで同じユーザー操作を繰り返す（戻る処理中と履歴を
  使い切った後はどちらも無視されるため、押し過ぎにはならない）

## 14. リスクと対策

| リスク | 対策 |
| --- | --- |
| Playwright / Chromium更新で起動方法が変わる | lockfileで固定し、依存更新時にE2Eを先に実行する |
| service worker起動が遅い | 既存worker確認後に`waitForEvent('serviceworker')`を使う |
| request routing登録前に通信が始まる | context取得直後、page作成前にrouteを登録する |
| DNRとroute fulfillが干渉する | 起動spikeでresponse headerとconsoleを確認し、fixture responseを最小化する |
| fixtureがX DOMのコピーになる | 必要なrole / data-testid /属性だけを持たせ、実X固有確認と分離する |
| E2Eが内部実装へ密結合する | DOM、URL、storageのみをassertし、内部クロージャを参照しない |
| browser downloadが重い | Chromiumのみを導入し、Node回帰は引き続きnpm不要で実行可能にする |
| personal dataが混入する | 毎回一時profileを作り、認証情報を使用しない |

## 15. 完了条件

Phase 2をE2E基盤の初期完成とする。次をすべて満たすこと。

- 新規cloneから文書化された手順でChromiumをセットアップできる
- production manifest / productionコードにテスト専用分岐がない
- fixture外ネットワークへアクセスしない
- golden pathが5回連続で成功する
- iframe保持をinstance markerで確認できる
- 保存・再構築後の設定round-tripが一致する
- 失敗時にtrace、screenshot、console情報を取得できる
- `node tests/run.mjs`と`verify.ps1`が引き続き成功する
- 実Xで未確認の項目を完了扱いにしていない

## 16. 実装開始時の判断事項

実装時に次だけを再確認する。

1. 採用する`@playwright/test`のversionと対応Node.js version
2. WindowsローカルとGitHub Actionsで利用するChromium revision
3. route fulfillしたx.com iframeへcontent scriptが期待どおり注入されるか
4. DNR更新後もfixture responseが安定して読み込まれるか
5. extension pageからstorageを投入・読取できるか

3〜5が起動spikeで成立しない場合は、productionコードを変更する前に設計を見直す。
