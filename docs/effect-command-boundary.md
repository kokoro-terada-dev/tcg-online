# 効果操作のサーバー受付境界

EffectCommandHostは、サーバーが生成した1個のTimedMovementEffectを専有する受付処理です。
既存server.tsには登録していません。Socketイベント・現在の対戦・UIは変更していません。
これは認証システムやMatch全体の管理器ではなく、その内側で使用する同期的な受付部品です。

後続の [Socket接続部品](effect-socket-boundary.md) で実Socket通信と席別配信を追加しました。現行server.ts/Match/UIには引き続き未登録です。

## サーバー側の契約

- サーバーが登録済み定義・発動元・identity・MovementRulesから実行器を生成して渡します。
- handle(actor, input)のactorはsocketの入室情報から確定します。入力JSONから採用しません。
- Hostへ渡した実行器を別の経路から変更しません。対戦単位の所有者と直列化が別途必要です。
- 応答は要求者だけへ返します。他方の状態通知はviewFor(other)で別々に投影します。
- Host本体はシリアライズ禁止です。完全な盤面・生イベント・定義・コスト計画を送信しません。

## 入力

全コマンドにkind / matchId / resolutionId / requestId /
expectedMovementRevision / expectedProgressionRevisionが必要です。
kindはbeginCosts / answerCosts / commitCosts / cancelCosts / start / advance / answerEffectです。
answerCosts/answerEffectだけにselectionIdとtokens配列を追加します。
回答用のMovement revisionはexpectedMovementRevisionから組み立てます。

```json
{
  "kind": "beginCosts",
  "matchId": "m",
  "resolutionId": "r",
  "requestId": "request-1",
  "expectedMovementRevision": 0,
  "expectedProgressionRevision": 7
}
```

実際のIDとrevisionは最新Viewを使います。actor、効果定義、sourceId、ルール判定、
任意の操作量などを追加すると拒否します。任意コードや式を評価する入口はありません。
不明な項目、非整数revision、アクセサー、疎配列、重複トークンなどを拒否し、検証後にコピーします。
トークンは最大128個、IDは用途ごとに64～100文字、全体は最大16KiBです。

## 再送

受理した形式の要求は、席とrequestIdで実行結果を記録します。
同じ内容なら再実行せずreplayed:trueと最新Viewを返します。過去の選択Viewは再配布しません。
同じIDで内容を変えた要求はrequest_conflictです。JSONの項目順だけの違いは同じ内容です。
成功だけでなくoperation_rejectedやselection_retryも記録します。
操作の修正・新しい操作には新しいrequestIdが必要です。

席ごとに最大1024件を保持し、古い記録は削除しません。満杯なら新規要求をrequest_limitで拒否します。
他方の予算を消費せず、既存要求の再送には応答できます。上限時に黙って再送保護を失いません。
不正形式・別コンテキスト・再入中の要求は操作を実行せず、通常の実行記録には追加しません。

## 出力と失敗

応答はok / code / requestId（検証できた場合）/ replayed / viewです。
codeはapplied / selection_retry / operation_rejected / invalid_command / wrong_context /
request_conflict / request_limit / busyの固定値です。
operation_rejectedは必ずしも盤面不変を意味しません。支払い確定後の効果失敗なら、
支払い済み・blockedな最新Viewを返します。内部例外文やカード実体IDをエラー文として返しません。

ViewはMovementの既存公開投影、限定した効果・進行サマリー、本人用のSelectionViewだけです。
相手の非公開手札・山札のカードID/実体参照、sourceFacts、定義、bindings、内部履歴は含めません。
選択候補は選択者以外にはnullです。進行gateの生のresolution/selection情報も配布しません。

## 未接続

- サーバー登録定義からの効果一覧・発動元選択と、次の効果への引き継ぎ
- 実際のMatch/ルームへの登録（Socket接続部品と個別通知は独立テストに対応済み）
- クライアントの選択UI、通信中表示、タイムアウト、再接続
- 永続化、対戦全体の要求ID管理・レート制御、終了時のHost破棄
- カード固有の発動制限、完全なルール判定、実カード定義の登録

受付テストが通っても、対戦画面で自動効果が使用可能になったわけではありません。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/effect-command-host.cjs
```
