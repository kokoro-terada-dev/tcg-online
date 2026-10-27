# テスト対戦：初回サーバー作成と公開手順

## 今回できること

トップページの「対戦」の下に「テスト対戦」を追加しました。
専用サーバーでルーム作成、4桁コード入室、READY切替、退出・切断時の片付けができます。
通常対戦のルーム・通信・ゲーム状態とは別です。
この段階では盤面・デッキ選択・効果処理・対戦開始はまだ実装していません。

## 1. コードをGitHubに送る

このチャットでpush完了と報告されている場合は、繰り返す必要はありません。
未送信の場合はVS Codeのターミナルで次を順番に実行します。

```powershell
cd C:\Users\kensh\workspace_server
git status
git add src/App.tsx src/components/DeckSelect/DeckSelect.tsx src/testMatch server/src/test server/test/test-lobby.cjs render-test.yaml TEST_MATCH_SETUP.md
git commit -m "Add isolated test match lobby and server"
git push origin main
```

この変更の送信でVercelの自動デプロイが始まる場合があります。
テスト用URLをまだ設定していない場合、テスト対戦画面には接続先未設定と表示されます。
既存の通常対戦用サーバーの起動コマンドは変更しません。

## 2. Renderに新しいサービスを作る

1. https://dashboard.render.com/ にログイン。
2. 「New」→「Web Service」を選ぶ。既存サーバーの設定画面は変更しない。
3. GitHubリポジトリ `kokoro-terada-dev/tcg-online` を選択。
4. 次の設定を入力。

| 項目 | 入力値 |
| --- | --- |
| Name | tcg-test-server（使用済みなら別の名前） |
| Branch | main |
| Runtime / Language | Node |
| Root Directory | server |
| Build Command | npm ci --include=dev && npm run build |
| Start Command | node dist/test/index.js |
| Instance Type | Free |
| Health Check Path（設定欄がある場合） | /health |

5. Environment Variablesに次の2つを登録。

| Key | Value |
| --- | --- |
| NODE_ENV | production |
| ALLOWED_ORIGINS | https://tcg-online-theta.vercel.app |

公開サイトのURLが違う場合、ALLOWED_ORIGINSには実際のフロントURLを登録します。
末尾の `/` は付けません。複数ある場合はカンマ区切りです。

6. 「Create Web Service」または「Deploy Web Service」を押す。
7. Liveになるまで待ち、Logsに `Test server listening on ...` があることを確認。
8. 表示された `https://...onrender.com` のURLを控える。名前から推測しない。
9. そのURLをブラウザーで開き、`"service":"tcg-test"` と `"status":"ok"` が表示されることを確認。
10. SettingsのAuto-DeployはOFFにすると、通常の変更をpushするたびにテストサーバーが再起動するのを避けられます。

`render-test.yaml` は同じ設定を記載したBlueprint用ファイルです。
上記の手動作成を行う場合はインポート不要です。
両方を行うとサービスが重複するので、片方だけにしてください。

## 3. VercelへテストサーバーのURLを登録

1. https://vercel.com/dashboard にログイン。
2. 現在のWebアプリのプロジェクトを開く。
3. Settings → Environment Variables を開く。
4. 次を追加し、Productionに適用して保存。

| Key | Value |
| --- | --- |
| VITE_TEST_SERVER_URL | Renderで控えた実際の https://...onrender.com |

通常対戦用の `VITE_SERVER_URL` は変更しません。
テスト用URLは公開情報なので、秘密のAPIキーは入力しないでください。

5. Deploymentsを開き、今回のコードを含む最新デプロイを選ぶ。
6. Redeployを押し、Readyまで待つ。環境変数は再ビルドで反映されます。

## 4. 2端末で確認

1. 両方でWebアプリを開き直す。
2. 片方で「テスト対戦」→「ルーム作成」。4桁コードを確認。
3. もう片方も「テスト対戦」を開き、同じコードで入室。
4. ホスト・ゲストが両方入室済みになることを確認。
5. 両方でREADYを押し、「両プレイヤー READY」を確認。
6. ゲストが退出すると、ホストの部屋は残り、ゲストは入室待ちになる。
7. ゲストが再入室し、ホストが退出すると両者ともルームから戻る。
8. 通常の「対戦」でも従来のルーム作成ができることを確認。

無料サービスは起動に時間がかかる場合があります。
接続できない場合はRenderのURLを開き、Live状態・Logs・ALLOWED_ORIGINS・Vercelの環境変数を確認します。
再デプロイ・再起動ではテストルームは消えます。

## PCでローカル確認

ターミナル1:

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node dist/test/index.js
```

ターミナル2:

```powershell
cd C:\Users\kensh\workspace_server
npm run dev -- --host 0.0.0.0
```

通常対戦は3000番、テスト対戦は3001番で接続します。
iPhoneではPCと同じWi-FiからPCのIPアドレスで開きます。
PCのファイアウォールで3001番への接続が許可されている必要があります。

テストを実行する場合:

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/test-lobby.cjs
```

## 今後の追加先

- `src/testMatch/`: テスト専用画面と、今後の対象選択・確認UI。
- `server/src/test/`: テスト専用ルームと、今後の対戦状態・効果定義・実行処理。
- `server/src/test/index.ts`: テスト用サーバーの起動入口。
- 通常対戦の `server/src/index.ts` と `src/network/socket.ts` は変更不要。
