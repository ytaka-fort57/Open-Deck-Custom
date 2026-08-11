# Open-Deck を fork してカスタム開発プロジェクトを作る手順

最終確認日: 2026-07-18

## 1. この手順の目的

この文書では、[kawa-nobu/Open-Deck](https://github.com/kawa-nobu/Open-Deck) を自分の GitHub アカウントへ fork し、Windows 上にカスタム版の開発プロジェクトを用意して、次の状態まで進めます。

- Chromium 系ブラウザーで fork 版をデベロッパーモード実行できる
- Firefox 用パッケージも作成できる
- 独自変更を本家コードから分離して管理できる
- 本家 `Release` ブランチの更新を検知し、必要な変更だけを意味移植できる
- 最初の不具合修正を安全に開始できる

この手順は GitHub リポジトリとローカル開発環境の作成までを対象とします。画像ビューアーやカラム復元不具合の実装修正は、環境作成後の別工程です。

## 2. 先に知っておくべき本家の構成

2026-07-16 時点で確認した本家の特徴は次のとおりです。

- 既定ブランチは `main` ではなく `Release`
- `main` は実質的に空に近いため、開発元として使わない
- npm、Vite、Webpack などを使う一般的なビルドプロジェクトではない
- JavaScript、HTML、画像、マニフェストを直接読み込むブラウザー拡張
- Chromium 用は `manifest.json`（Manifest V3）
- Firefox 用は `manifest_firefox.json`（Manifest V2）
- `package.ps1` を実行すると、Chromium 版と Firefox 版の ZIP が `package/` に作られる
- Firefox 版の作成時は、スクリプトが一時領域で `manifest_firefox.json` を `manifest.json` に置き換える
- ライセンスは MIT。ただし、フォーク版にも元の `LICENSE` と著作権表示を残す

したがって、初期段階では Node.js や `npm install` は不要です。

## 3. 推奨するブランチ構成

```text
本家 kawa-nobu/Open-Deck
└─ Release
      ↓ upstream として取得
自分の fork
├─ Release             本家追従用。独自変更を直接入れない
├─ custom              カスタム版の統合ブランチ
├─ feature/media-viewer
├─ fix/column-restore
└─ codex/upstream-port-YYYYMMDD  本家の採用分を意味移植する作業ブランチ
```

`Release` に独自変更を直接積み重ねると、本家更新との区別がつきにくくなります。通常作業は `custom` から機能ブランチを作り、完了後に `custom` へ Pull Request で統合します。

## 4. 必要なもの

必須:

- GitHub アカウント
- Git for Windows
- PowerShell 7 または Windows PowerShell
- Chrome、Edge、Brave などの Chromium 系ブラウザー
- X にログインできるブラウザープロファイル

任意:

- Firefox（Firefox 版も確認する場合）
- GitHub CLI `gh`（CLI で fork、Pull Request 作成を行う場合）
- Visual Studio Code などのエディター

確認コマンド:

```powershell
git --version
pwsh --version
gh --version
```

`gh` は任意なので、未導入でも GitHub の Web UI だけで進められます。

## 5. GitHub 上で fork を作る

1. [本家リポジトリ](https://github.com/kawa-nobu/Open-Deck)を開く。
2. 右上の **Fork** を押す。
3. Owner に自分の GitHub アカウントを選ぶ。
4. Repository name は `Open-Deck` のままでも、`Open-Deck-Custom` などへ変更してもよい。
5. Description に、たとえば `Personal Open-Deck customization` と記載する。
6. **Create fork** を押す。

本家の既定ブランチは `Release` です。「既定ブランチだけをコピーする」選択肢が表示される場合は、それを選んでも本手順には十分です。

fork 後に確認する項目:

- fork 元として `kawa-nobu/Open-Deck` が表示されている
- fork の既定ブランチが `Release` になっている
- `manifest.json`、`manifest_firefox.json`、`content.js`、`package.ps1` が見える

## 6. Windows にローカルプロジェクトを作る

以下では、GitHub ユーザー名を `YOUR-GITHUB-NAME`、fork 名を `Open-Deck` とします。実際の値へ置き換えてください。

```powershell
$ProjectRoot = "C:\Users\forti\Documents\work\blowserextension\projects"
$GitHubUser = "YOUR-GITHUB-NAME"
$ForkName = "Open-Deck"
$LocalName = "open-deck-custom"

New-Item -ItemType Directory -Force -Path $ProjectRoot | Out-Null
Set-Location $ProjectRoot

git clone --branch Release "https://github.com/$GitHubUser/$ForkName.git" $LocalName
Set-Location $LocalName
```

SSH 鍵を設定済みの場合は、clone URL を次の形式にできます。

```powershell
git clone --branch Release "git@github.com:$GitHubUser/$ForkName.git" $LocalName
```

## 7. `upstream` を登録する

clone 直後の `origin` は自分の fork です。本家を `upstream` として追加します。

```powershell
git remote add upstream https://github.com/kawa-nobu/Open-Deck.git
git fetch upstream
git remote -v
```

期待される形:

```text
origin    https://github.com/YOUR-GITHUB-NAME/Open-Deck.git (fetch)
origin    https://github.com/YOUR-GITHUB-NAME/Open-Deck.git (push)
upstream  https://github.com/kawa-nobu/Open-Deck.git (fetch)
upstream  https://github.com/kawa-nobu/Open-Deck.git (push)
```

`upstream` へ push する必要はありません。変更の送信先は `origin` です。

## 8. カスタム版の統合ブランチを作る

```powershell
git switch Release
git pull --ff-only origin Release

git switch -c custom
git push -u origin custom
```

GitHub の fork ページで `custom` ブランチが作成されたことを確認します。必要なら fork の **Settings > Branches** で既定ブランチを `custom` に変更します。

カスタム版の配布元を明確にするため、forkの既定ブランチは`custom`を推奨します。本家の確認済み位置は`.github/upstream-base`で管理するため、GitHubの標準Sync fork機能は`custom`へ使いません。

## 9. 最初のローカル検証

依存関係のインストールは不要です。まず JSON と Git の基本状態を確認します。

```powershell
Get-Content -Raw .\manifest.json | ConvertFrom-Json | Out-Null
Get-Content -Raw .\manifest_firefox.json | ConvertFrom-Json | Out-Null
git diff --check
git status --short
```

エラーがなければ、Chromium 版をそのまま読み込めます。

## 10. Chrome、Edge、Brave で開発版を読み込む

1. Web Store 版 Open-Deck が入っている場合は、誤作動を避けるため一時的に無効化する。
2. 次の拡張機能管理画面を開く。
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
3. **デベロッパーモード**を有効にする。
4. **パッケージ化されていない拡張機能を読み込む**を押す。
5. ローカルの `open-deck-custom` フォルダーを選ぶ。
6. エラーが表示されず、Open-Deck のアイコンが出ることを確認する。
7. X にログインした状態で、公式 README が案内している `https://twitter.com/run-opdeck` を開く。

ソースを変更した後は、拡張機能管理画面の Open-Deck カードにある再読み込みボタンを押してから対象タブを再読み込みします。`background.js`、`manifest.json`、content script の変更は、ページの再読み込みだけでは反映されない場合があります。

## 11. Firefox で開発版を読み込む

Firefox 用はルートの `manifest_firefox.json` をそのまま選ぶのではなく、付属スクリプトで Firefox 用 ZIP を作ります。

```powershell
Set-Location "C:\Users\forti\Documents\work\blowserextension\projects\open-deck-custom"
.\package.ps1
Get-ChildItem .\package
```

実行ポリシーで `.ps1` が拒否された場合は、現在のプロセスに限って次のように実行します。

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\package.ps1
```

出力例:

```text
package\Open-Deck_Firefox_1_1_3_7.zip
package\Open-Deck_Chromium_1_1_3_7.zip
```

バージョン部分は実行時の `manifest.json` によって変わります。

Firefox 開発用に展開します。

```powershell
$FirefoxZip = Get-ChildItem .\package\Open-Deck_Firefox_*.zip |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

Remove-Item .\.firefox-dev -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $FirefoxZip.FullName -DestinationPath .\.firefox-dev
```

次に Firefox で以下を行います。

1. `about:debugging#/runtime/this-firefox` を開く。
2. **一時的なアドオンを読み込む**を押す。
3. `.firefox-dev\manifest.json` を選ぶ。
4. X の対象ページを開いて動作確認する。

一時アドオンは Firefox の終了時に解除されます。日常開発の主対象を Chromium にし、Firefox は節目ごとに確認すると作業が簡単です。

## 12. 開発用ファイルを Git 管理から除外する

本家の `.gitignore` はすでに `package` を除外しています。`package_tmp` は正常終了時に削除されます。Firefox のローカル展開先だけを追加で除外します。

```gitignore
.firefox-dev/
```

追加後:

```powershell
git add .gitignore
git commit -m "chore: ignore local extension packages"
git push
```

## 13. 独自拡張コードの置き場所を用意する

本家変更の意図とカスタム側の責務を対応付けやすくするため、最初から独自コードを専用フォルダーへ分離します。

推奨案:

```text
extensions/
└─ custom/
   ├─ index.js
   ├─ media-viewer.js
   ├─ column-state.js
   ├─ keyboard-shortcuts.js
   ├─ selectors.js
   └─ storage.js
```

最初は `extensions/custom/index.js` を入口にし、`manifest.json` と `manifest_firefox.json` の content script 配列へ追加します。

例:

```json
"js": [
  "content.js",
  "extensions/utils.js",
  "extensions/text_review.js",
  "extensions/auto_reload.js",
  "extensions/media_viewer_block.js",
  "extensions/media_viewer/media_viewer.js",
  "extensions/custom/index.js"
]
```

Firefox 側はもともとの配列が Chromium 側と完全には同じではないため、既存項目を揃えるのではなく、末尾に独自入口だけを追加します。

本家ファイルの変更を一箇所もなくすことはできませんが、マニフェストの入口追加だけに抑えると、本家差分をレビューするときに独自処理との境界を追いやすくなります。

## 14. 最初の作業ブランチを作る

画像ビューアー改善から始める例:

```powershell
git switch custom
git pull --ff-only origin custom
git switch -c feature/media-viewer
```

カラム復元不具合から始める場合:

```powershell
git switch custom
git pull --ff-only origin custom
git switch -c fix/column-restore
```

小さな単位でコミットします。

```powershell
git add manifest.json manifest_firefox.json extensions/custom
git commit -m "feat: add custom enhancement entrypoint"
git push -u origin feature/media-viewer
```

GitHub 上で `feature/media-viewer` から `custom` 向けの Pull Request を作成し、動作確認後にマージします。

## 15. 不具合修正前に残す再現記録

コードを変える前に、最低限次を Issue または `docs/` に記録します。

### 画像ビューアー

- ブラウザー名とバージョン
- 単一画像か複数画像か
- クリック後に画像全体が収まらない状態のスクリーンショット
- `Esc` を押したときの実際の挙動
- X 標準のメディアモーダルか Open-Deck 独自ビューアーか
- コンソールエラー

なお、本家にはメディアビューアーのキーボード操作に関する [Issue #24](https://github.com/kawa-nobu/Open-Deck/issues/24) が存在します。

### リロード時の初期表示

- 保存済みプロファイル名
- カラム数と並び順
- リロード前に選択されていたカラム
- リロード後に選択されるカラム
- 通常リロードと `Ctrl+Shift+R` の差
- プロファイルを切り替えた直後かどうか
- `chrome.storage.local` または `browser.storage.local` の保存内容

## 16. 本家更新をレビューして意味移植する

カスタム版では`upstream/Release`を`custom`へ直接mergeしません。本家の更新頻度に対してカスタム側の構造差が大きくなったため、変更意図を読み、必要な部分だけを現在の設計へ再実装する方が総作業量と回帰リスクを抑えられるためです。

まず未確認範囲を取得します。

```powershell
git fetch upstream Release
$Base = (Get-Content -Raw .\.github\upstream-base).Trim()
$Latest = git rev-parse upstream/Release
git log --reverse --oneline "$Base..$Latest"
git diff --name-status "$Base..$Latest"
git diff --stat "$Base..$Latest"
```

各コミットを「採用」「対応不要」「既に独自実装済み」に分類します。採用分は`custom`から作業ブランチを作り、原則としてmerge／cherry-pickせず、関連テストを追加してから機能の意味だけを再実装します。

```powershell
git switch custom
git pull --ff-only origin custom
git switch -c codex/upstream-port-YYYYMMDD
# 必要な変更を再実装
.\verify.ps1
```

全コミットの判断と検証が終わったら、同じPRで`.github/upstream-base`を`$Latest`へ進め、[upstream-port-log.md](upstream-port-log.md)へ判断理由を追記します。採用しないコミットにも理由を残してください。

## 17. GitHub Actions で未確認更新を課題化する

`.github/workflows/sync-upstream.yml`は毎週月曜03:20 JSTに本家を確認します。差分がある場合は、コミット、変更ファイル、比較URL、差分量を一つのGitHub Issueへまとめます。ブランチ作成、merge、push、Pull Request作成は行いません。

forkのGitHub画面では次を確認します。

1. **Settings > Actions > General** でWorkflow permissionsの書き込みを許可する。
2. **Actions > Review upstream > Run workflow** で手動実行する。
3. 更新がない場合はIssueが作成されず、更新がある場合だけレビューIssueが作成または更新されることを確認する。

Issueへの書き込みには`issues: write`だけを使い、repository contentsはread権限に限定しています。`.github/upstream-base`が本家最新SHAと一致している間は、定期実行しても追加作業は発生しません。

## 18. 意味移植 Pull Request の確認項目

- 基準から最新までの全コミットに判断を記録した
- 採用分がカスタム版の責務分割とstorage形式を壊していない
- 対応不要／既存対応とした理由が`docs/upstream-port-log.md`にある
- `manifest.json`と`manifest_firefox.json`の独自入口が維持されている
- `.\verify.ps1`が32テストとChromium／Firefox両ZIPの検査を完了する
- Open-Deck起動、プロファイル切り替え、カラム追加・並べ替え・削除を確認した
- 画像の開閉とリロード後のカラム状態を確認した
- コンソールに新しい例外が出ていない
- `.github/upstream-base`をレビュー済み最新SHAへ更新した
- 対応するレビューIssueを閉じた

## 19. 初回セットアップ完了の判定

次をすべて満たせば、fork からプロジェクト作成までは完了です。

- [ ] GitHub 上に fork がある
- [ ] ローカルへ `Release` を clone した
- [ ] `origin` が自分の fork、`upstream` が本家になっている
- [ ] `custom` ブランチを作成して push した
- [ ] Chromium でローカル拡張を読み込めた
- [ ] `https://twitter.com/run-opdeck` を開いて基本画面を確認した
- [ ] `package.ps1` で Chromium/Firefox の ZIP を生成できた
- [ ] 独自コード用 `extensions/custom/` の方針を決めた
- [ ] 最初の作業ブランチを作成した
- [ ] 本家更新をGitHub Actionsで検知し、意味移植する方法を決めた

## 20. 次に着手する順序

1. 現行版で不具合の再現手順とスクリーンショットを残す
2. `extensions/custom/index.js` の入口を追加する
3. 画像ビューアーの全体表示、`Esc`、背景クリックを修正する
4. リロード前後のプロファイル、選択カラム、カラム URL の保存状態を調査する
5. Chromium で安定させる
6. Firefox の差分を吸収する
7. 本家レビューIssueの週次検知を有効にする

## 参考リンク

- [Open-Deck 本家](https://github.com/kawa-nobu/Open-Deck)
- [Open-Deck の Release ブランチ](https://github.com/kawa-nobu/Open-Deck/tree/Release)
- [Open-Deck Issues](https://github.com/kawa-nobu/Open-Deck/issues)
- [GitHub Docs: Fork a repository](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo)
- [GitHub Docs: Configuring a remote repository for a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/configuring-a-remote-repository-for-a-fork)
- [GitHub Docs: Syncing a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)
- [GitHub Docs: GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
