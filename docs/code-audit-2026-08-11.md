# Open-Deck Custom 不具合・改善候補監査

監査日: 2026-08-11  
基準コミット: `a293653`  
対象: コミット後のカスタムコード、テスト、配布検証、運用ドキュメント

## 結論

現時点で、テストと配布検査が通らない高優先度のコード不具合は確認していない。引用付きメディアの選択境界はコード修正済みで、残るのはXの現行DOMを使った動作確認である。その他は、Firefox本体・GitHub Actionsなどローカルの静的検証だけでは確定できないものと、利用条件が揃った時に改善する低優先度の設計課題に分ける。

## 検証結果

- `node tests/run.mjs`: 33/33 成功
- `verify.ps1`: 成功
- Chromium ZIP: 62エントリ、許可リスト・manifest検査成功
- Firefox ZIP: 62エントリ、許可リスト・manifest検査成功
- 全JavaScriptの`node --check`、locale・manifest参照検査、storage／sender／URL安全境界の回帰検査: 成功
- 実サイトのログイン済みX操作、Firefox Manifest V2実機操作、GitHub Actionsの手動dispatch: 未実施

## コミットで確認した修正済み範囲

- ページ・カラムのobserver、listener、自動更新、メディアtokenの破棄境界
- 設定import、storage mutation、sender検証、安全な属性・URL境界
- 動画variantのHTTPS MP4・bitrate選択
- リスト内の同一作者リポストと「有料パートナーシップ」投稿の非表示
- ポスト列でのcomposerだけの非表示と戻るボタンの維持
- GIF／動画の再生・一時停止クリックをメディア拡大処理へ伝播させない境界
- 過去監査・調査文書を`docs/archive/`へ移動し、現行backlogと導線を更新

## 不具合・改善候補

| ID | 優先度 | 種別 | コード上確認できる事実 | 次の確認・対応 |
| --- | --- | --- | --- | --- |
| A-1 | 中 | コード修正済み・未検証 | 引用コンテナを特定できた場合に引用側の`mediaDetails`を優先し、外側ポストの情報へフォールバックする処理と回帰テストを追加した | 現行Xの引用DOMとReact propsを保存したfixtureで、引用元・引用先の選択結果を実ブラウザーで確認する |
| A-2 | 中 | 外部検証 | カスタムコードは両manifestへ登録され、ZIP検査も通るが、Firefox本体とログイン済みXの操作は未実施 | Firefoxで列追加・再読込・メディア・リスト・投稿列を確認する |
| A-3 | 低 | 保存境界 | 文章校正ヘルパーのハッシュタグはXページの`localStorage`へ保存され、Open-Deckのstorage repositoryは経由しない | プロファイル単位の保持が必要になった時点で、キー設計・移行・削除UIをまとめて実装する |
| A-4 | 低 | 実行テスト | `content.js`の大部分はDOM初期化とiframe連携で、現行回帰テストは文字列・配線検査が中心 | 純粋関数またはcontrollerへ責務を分ける際に、DOM fixtureを段階的に追加する |
| A-5 | 低 | 性能改善 | リストフィルタはiframeごとにMutationObserverと1秒周期タイマーを持ち、更新のたびに全tweetを走査する | 大量フィードでCPU・Mutation回数を計測し、必要なら対象範囲と差分走査を絞る |
| A-6 | 低 | ロケール拡張 | 有料パートナーシップ判定は日本語の`有料パートナーシップ`完全文字列を対象にしている | 英語など他言語UIでも同機能が必要になった場合、表示文言以外の安定属性またはロケール別ラベルを追加する |
| A-7 | 低 | 設計保留 | タブ状態は現在、追加・削除・並べ替え時の位置remapで保護している | 全プロファイル移行、旧データ互換、実ブラウザーfixtureを揃えてから安定ID化を検討する |
| A-8 | 中 | 外部運用 | `sync-upstream.yml`のレビューIssue作成・更新はGitHub上の手動dispatchを必要とする | originへ反映後、更新なし／更新ありの2ケースを一度だけ実行確認する |

## 対応しない境界

- `misskey` / `bsky`は現行deckに描画templateがなく利用予定もないため、描画・保存・import・移行testを一組で実装できる時まで保留する。
- タイムラインの「おすすめ」「フォロー中」を同一アカウントで独立カラムとして復元することは、X側がタブ選択をアカウント単位で共有するため対象外とする。
- 実サイト未検証の項目を、ローカルテスト成功だけで動作確認済みとは扱わない。

## 関連文書

- 現在の残課題: [backlog.md](backlog.md)
- 完了済み監査: [docs/archive/README.md](archive/README.md)
- fork運用手順: [open-deck-fork-project-setup.md](open-deck-fork-project-setup.md)
