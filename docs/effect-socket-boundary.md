# 効果操作のSocket接続部品

`server/src/test/effects/effectSocket.ts` のbindEffectSocketは、既存EffectCommandHostを
Socket.IOへ接続する部品です。実Socketを使った2クライアントの通信テストまで追加しました。
現在のserver.ts・ルーム・Match・対戦画面にはまだ登録していません。
したがって公開サイトで自動効果が使用可能になった変更ではありません。

## 登録するイベント

- `test-effect:command(payload, acknowledgement)`: 効果コマンドを処理し、要求者へ応答します。
- `test-effect:sync(acknowledgement)`: 本人用の最新Viewを返します。入力で対戦を指定できません。
- `test-effect:state(view)`: 状態が変化した操作後に、各プレイヤーへ個別に配信します。

acknowledgementがない要求は実行しません。同じ要求の再送で状態が変わらなければ、
再送のacknowledgementだけを返し、重複した更新通知は配信しません。
操作失敗でも支払い済み/blockedなどへ状態が変化した場合は、両者へ最新状態を配信します。

## サーバー側の接続契約

bindEffectSocket(io, socket, resolver)をdefault namespaceのサーバーSocketに対して呼びます。
resolver(socketId)は、サーバーが管理する次の値を同期的・副作用なしで返す関数です。

```typescript
type Membership = {
  host: EffectCommandHost;
  actor: 0 | 1;
  socketIds: readonly [string, string];
};
```

未入室/対象外ならnullです。payload、クライアント申告のactor、roomId、matchIdから
Hostや配信先を選択してはいけません。この部品はログインや再接続認証そのものではありません。
最終的なルーム所属・席の認証を行う管理層がresolverを提供します。

双方のSocketが接続中で、同じHostと同じ席配置を指すことを要求ごとに確認します。
本人IDとactorの位置も照合します。不一致・切断・resolverエラーはnot_availableを返し、Viewを含めません。
操作直後にも所属を再確認し、途中で変わった場合は古いViewを返したり配信したりしません。
その場合も、既に確定した効果を勝手に巻き戻さず、Hostの再送保護を維持します。

配信は検証したサーバーSocketオブジェクトへ直接emitします。room名による一括配信はしません。
各Viewは既存投影を通し、相手の非公開カードID・実体参照や他人の選択候補を含めません。
Socketの部屋に第三者が混在していても、そこへまとめて配信しません。

## 制限とライフサイクル

- commandとsyncを合算し、1 Socketにつき10秒間に最大60要求です。超過時はrate_limitedを返し実行しません。
- Hostの席別要求ID管理と再送保護は別に維持します。
- 内部例外の文字列は返さず、受付の予期しない失敗はinternal_errorです。
- 同じSocketへの二重登録を拒否し、返却するdisposeは冪等です。
- disconnectでリスナーを解除します。効果や支払いの自動取消し・返金はしません。
- 片方が切断中は他方の操作も停止します。信頼する管理層が両席を新しいSocketへ再対応付けするとsync可能です。
- Hostが生存する同一プロセス内では、選択待ちのIDとトークンを再取得できます。永続化復元ではありません。
- Socket.IOサーバー側のCORS・認証・maxHttpBufferSize・IP単位制限も、組込み時に設定する必要があります。

低レベルのcommandと応答形式は [受付境界](effect-command-boundary.md) を参照してください。
クライアントは応答Viewの両revisionとselectionIdを使い、新しい操作には新しいrequestIdを付けます。
通知は更新があった場合だけなので、初回・再接続時はsyncで状態を取得します。

## 未接続

- 現行ルームのMembership/Matchとの対応付け、手動操作と自動効果の同時書込み防止
- 実カードのサーバー登録定義・発動元選択・次の効果へ進む管理
- 対戦画面のコマンド送信と選択UI
- 実運用の再接続本人確認・切断猶予・対戦終了/解散時のHost破棄
- サーバー再起動を越える保存・復元

今回のテストは、独立した実行器をテスト用HTTP/Socket.IOサーバーへ接続し、
実際のsocket.io-clientで操作します。テストサーバーは自動終了し、既存サービスを起動・変更しません。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/effect-socket.cjs
```
