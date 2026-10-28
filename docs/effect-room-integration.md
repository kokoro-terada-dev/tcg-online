# テストルームへの任意設定による効果接続

createTestServerのサーバー内部オプションeffectFactoryで、既存ルームのMatchに
EffectMatchOwnerとOwnedEffectEndpointを登録できるようになりました。
標準のcreateTestServer()は従来の手動対戦のままで、現在の起動コードにもオプションを渡していません。
環境変数やクライアント操作で有効化する機能は追加していません。

## 有効化の契約

```typescript
createTestServer({
  effectFactory(match) {
    // Trusted server code constructs authoritative progression, adopts the match,
    // and opens a supported registered effect before returning its owner.
    return preparedOwner;
  },
});
```

preparedOwnerは説明用の名前で、実行できる完成例ではありません。
factoryには対戦開始時の新しいMatchが渡ります。返却値はautomatedなEffectMatchOwnerで、
同じmatchIdの盤面と使用可能な効果を持つ必要があります。定義・手番・発動元はサーバーが決定し、
クライアント入力をfactoryやルール判定として受け付けません。
チェックポイントを無条件で完了したことにする設定を実対戦に使用してはいけません。

## ルーム内の動作

- 作成/入室/デッキ/READYの経路は従来と同じです。
- factoryの設定がある場合だけ、Socketに効果用イベントを登録します。
- 対戦開始時にfactoryを呼び、正常に準備できた場合だけroom.gameとroom.effectsを同時に設定します。
- 初期Viewはtest-effect:stateで両席へ個別配信し、古いtest-match:stateは配信しません。
- resolverは既存のサーバー所属情報からroom/席/Endpointを取得します。
- 効果側を使用する対戦では旧test-match:commandを拒否し、旧Matchへの並行書込みを防ぎます。
- 初期化失敗時は対戦を作成せず、内部例外の詳細も返しません。部屋とREADYは保持し再試行できます。
- 終了時は所有者を閉じ、部屋とコードを維持します。新しい開始は別のMatch/所有者になります。
- ゲスト退出/切断では所有者を閉じて試合を終了し、ホストの部屋は維持します。
- ホスト退出/切断では所有者を閉じて部屋を削除し、ゲストの所属も解除します。
- 古いMatchや旧席からの効果要求は使用できません。

## 検証と未対応

effect-room.cjsは既存createTestServerへテスト専用factoryを注入し、実Socketで入室から
ドロー効果・終了・退出・解散・再試合まで確認します。factory内の進行と架空ドロー効果は
テストフィクスチャであり、実カードや実対戦の初期処理を実装したものではありません。
既存のtest-game/test-lobbyも標準設定で継続検証します。

現行画面の新View対応、登録済み実カード効果、正式な初期進行、通常操作/バトル全体、
効果一覧と次の効果への管理、公開サーバーでの有効化は未対応です。
この変更をpushしただけで、公開サイトが自動効果対戦へ切り替わることはありません。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/effect-room.cjs test/test-game.cjs test/test-lobby.cjs
```
