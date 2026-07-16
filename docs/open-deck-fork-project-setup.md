# Open-Deck を fork してカスタム開発プロジェクトを作る手順

最終確認日: 2026-07-16

## 1. この手順の目的

この文書では、[kawa-nobu/Open-Deck](https://github.com/kawa-nobu/Open-Deck) を自分の GitHub アカウントへ fork し、Windows 上にカスタム版の開発プロジェクトを用意して、次の状態まで進めます。

- Chromium 系ブラウザーで fork 版をデベロッパーモード実行できる
- Firefox 用パッケージも作成できる
- 独自変更を本家コードから分離して管理できる
- 本家 `Release` ブランチの更新を手動または GitHub Actions で取り込める
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
└─ sync/upstream       本家更新を custom に取り込む一時ブランチ
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

本家同期の基準を明確にしたい場合は、fork の既定ブランチを `custom` にするのがおすすめです。一方、本家との差分を GitHub の標準 Sync fork 機能で見たい場合は、`Release` を既定のままにしても構いません。

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

本家更新との競合を減らすため、最初から独自コードを専用フォルダーへ分離します。

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

本家ファイルの変更を一箇所もなくすことはできませんが、マニフェストの入口追加だけに抑えると同期時の競合が減ります。

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

## 16. 本家更新を手動で取り込む

まず本家追従用 `Release` を fast-forward します。

```powershell
git fetch upstream
git switch Release
git merge --ff-only upstream/Release
git push origin Release
```

次に `custom` へ同期用ブランチを作ります。

```powershell
git switch custom
git pull --ff-only origin custom
git switch -C sync/upstream
git merge upstream/Release
```

競合がなければ検証して push します。

```powershell
Get-Content -Raw .\manifest.json | ConvertFrom-Json | Out-Null
Get-Content -Raw .\manifest_firefox.json | ConvertFrom-Json | Out-Null
.\package.ps1
git diff --check custom...HEAD
git push -u origin sync/upstream --force-with-lease
```

GitHub 上で `sync/upstream` から `custom` 向けの Pull Request を作り、Chromium と Firefox の動作確認後に手動マージします。

コンフリクトが出た場合は、`content.js` 全体をどちらか一方で上書きせず、機能単位で差分を確認します。

## 17. GitHub Actions で同期 Pull Request を半自動作成する

`custom` ブランチに `.github/workflows/sync-upstream.yml` を作成します。

```yaml
name: Sync upstream

on:
  schedule:
    # 毎日 03:20 JST（GitHub Actions の cron は UTC）
    - cron: "20 18 * * *"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: sync-upstream
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout custom branch
        uses: actions/checkout@v6
        with:
          ref: custom
          fetch-depth: 0

      - name: Fetch upstream
        run: |
          git remote add upstream https://github.com/kawa-nobu/Open-Deck.git
          git fetch upstream Release

      - name: Prepare sync branch
        id: prepare
        shell: bash
        run: |
          if git merge-base --is-ancestor upstream/Release HEAD; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git fetch origin sync/upstream:refs/remotes/origin/sync/upstream || true
          git switch -C sync/upstream
          git merge --no-edit upstream/Release

          python -m json.tool manifest.json > /dev/null
          python -m json.tool manifest_firefox.json > /dev/null
          git diff --check origin/custom...HEAD

          git push --force-with-lease origin HEAD:sync/upstream
          echo "changed=true" >> "$GITHUB_OUTPUT"

      - name: Create pull request if needed
        if: steps.prepare.outputs.changed == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          existing="$(gh pr list \
            --base custom \
            --head sync/upstream \
            --state open \
            --json number \
            --jq '.[0].number')"

          if [ -z "$existing" ]; then
            gh pr create \
              --base custom \
              --head sync/upstream \
              --title "chore: sync upstream Release" \
              --body "Automated upstream sync. Review and test manually before merging."
          else
            echo "PR #$existing is already open and has been updated."
          fi
```

次に fork の GitHub 画面で以下を確認します。

1. **Settings > Actions > General** を開く。
2. Workflow permissions で書き込みを許可する。
3. **Allow GitHub Actions to create and approve pull requests** を有効にする。
4. **Actions > Sync upstream > Run workflow** で手動実行する。
5. `custom` 向け Pull Request が作成されることを確認する。

このワークフローは、マージが自動成功した場合だけ Pull Request を作ります。コンフリクトがある場合は Actions が失敗するので、ローカルで手動同期します。

完全自動マージは推奨しません。Git の競合がなくても、本家変更や X 側の DOM 変更によって機能が壊れる可能性があるためです。

また、`GITHUB_TOKEN` で作られた Pull Request は、別の `push` ワークフローを自動起動しない場合があります。この同期ワークフロー内で最低限の JSON 検証を行い、ブラウザーの実動作はマージ前に手動確認してください。

## 18. 同期 Pull Request の確認項目

- `manifest.json` と `manifest_firefox.json` の独自入口が消えていない
- `extensions/custom/` が維持されている
- Open-Deck 起動 URL を開ける
- 保存済みプロファイルを読み込める
- タイムライン、通知、Explore カラムを追加できる
- カラムの並べ替えと削除が動く
- 画像を開閉できる
- リロード後の対象カラムが意図どおり復元される
- コンソールに新しい例外が出ていない
- `package.ps1` が Chromium/Firefox の両 ZIP を作れる

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
- [ ] 本家同期を手動または GitHub Actions で行う方法を決めた

## 20. 次に着手する順序

1. 現行版で不具合の再現手順とスクリーンショットを残す
2. `extensions/custom/index.js` の入口を追加する
3. 画像ビューアーの全体表示、`Esc`、背景クリックを修正する
4. リロード前後のプロファイル、選択カラム、カラム URL の保存状態を調査する
5. Chromium で安定させる
6. Firefox の差分を吸収する
7. 同期 Pull Request の定期実行を有効にする

## 参考リンク

- [Open-Deck 本家](https://github.com/kawa-nobu/Open-Deck)
- [Open-Deck の Release ブランチ](https://github.com/kawa-nobu/Open-Deck/tree/Release)
- [Open-Deck Issues](https://github.com/kawa-nobu/Open-Deck/issues)
- [GitHub Docs: Fork a repository](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo)
- [GitHub Docs: Configuring a remote repository for a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/configuring-a-remote-repository-for-a-fork)
- [GitHub Docs: Syncing a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)
- [GitHub Docs: GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
