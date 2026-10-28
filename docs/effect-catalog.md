# サーバー登録効果カタログ

EffectCatalogは、カード基本情報のマスターとは別に、サーバーが明示的に登録するDSL定義を保持します。
実カードの定義やファイルの自動読込は今回追加していません。既存CSV/card-master.jsonも変更しません。

## JSON形式

```json
{
  "catalogVersion": 1,
  "definitions": [
    {
      "dslVersion": 1,
      "effectId": "EXAMPLE.draw",
      "cardId": "EXAMPLE-LEADER",
      "trigger": { "kind": "activate", "window": "main" },
      "costs": [],
      "actions": [{ "kind": "draw", "player": "SELF", "amount": 1 }]
    }
  ]
}
```

これは架空の構造例です。実カードにこの効果があるという意味ではありません。
parseEffectCatalog(json)で形式番号とDSLを検証します。信頼するサーバーコードからは
new EffectCatalog(definitions)も使えます。パスの指定、実行コード、関数の登録は受け付けません。

## 検証と版固定

- effectIdはカタログ全体で一意です。同じIDを別カードへ登録しても拒否します。
- 各定義は既存DSL検証器を通し、入力から切り離したfreeze済みコピーを保存します。
- 上限は4096定義、全体8MiBです。定義ごとの65,536バイト等の既存制限も適用します。
- 版は検証後の定義をeffectId順に並べてハッシュ化します。入力順だけを変えても同じ版です。
- listForCard(cardId)はID・trigger・schemaOnlyの要約だけを返します。
- 登録・構造検証の成功は、そのカードが今その効果を実行できるという意味ではありません。
- card-masterのeffects/effectIds、表示用の手動効果は、実行定義へ自動昇格しません。
- カタログ本体をクライアントへシリアライズすることは禁止します。

## 盤面所有者からの発動

new EffectMatchOwner(match, catalog)で同じカタログを対戦中保持します。
openRegisteredEffect(effectId, actor, sourceRef, rules, numericPolicy?)で、現在のカード実体と
generationを確認し、そのcardIdに登録された定義だけを既存実行器へ渡します。
resolutionIdはサーバーがUUIDで生成します。クライアントから指定させません。

未登録ID、別カード、古い参照、別プレイヤーのカード、未対応の命令は開始前に拒否します。
発動タイミング・condition・コスト等の既存検証も引き続き必要です。
snapshotのcatalogVersionで使用版を識別できます。実行途中でカタログを差し替えるAPIはありません。

ローカルの固定テスト効果もこの登録経路へ変更しました。通常の公開起動は有効化していません。
登録済み効果一覧の参照通信は下記を参照してください。利用者が一覧から発動を選ぶUI、実カード定義、
ファイル配置・読込・マスターとの配布管理は今後の段階です。

## 一覧参照通信

`test-effect:catalog` は、自分の表向きのリーダー・キャラクター・ステージに
登録された効果の要約だけを、要求した接続へのackで返します。盤面は変更せず、相手へ配信しません。

要求は `matchId`、`expectedMovementRevision`、`expectedProgressionRevision`、
`source: { instanceId, generation }` です。プレイヤー番号はサーバーが接続から決めます。
古い盤面参照、相手カード、手札等の対象外エリア、不正な要求は拒否します。

成功時は `{ ok: true, catalog }` を返します。catalogには両revision、使用カタログ版、
カード参照、効果ID・trigger・`status: "schemaOnly"`・`timingAvailable` の一覧を含めます。
コストや処理定義の本体は返しません。カタログ未設定は版null・空一覧で明示します。

`timingAvailable` は起動効果のタイミングだけの判定です。コスト、回数制限などを含む
発動可能性の保証ではありません。イベント効果や処理待ち中はfalseです。
本番の自動効果は引き続き無効です。

## テスト画面での参照

自動効果のテスト盤面では、自分の表向きのリーダー・キャラクター・ステージを
タップすると、中央のダイアログにカード画像と登録済み効果一覧を表示します。
既存の中央パネルが盤面を覆う場合は「盤面を見る」でたたみ、
「効果処理に戻る」で復帰できます。処理段階が進むとパネルは自動で開きます。
たたむ前の未確定のカード選択も保持します。

サーバーで明示的に許可したローカルテストだけ、タイミングが一致する起動効果に
「発動する」を表示します。タイミング一致だけで発動可能と断定せず、サーバーで再検証します。
読込中、取得失敗、カタログ未設定、登録なしは区別します。
相手カードや手札はこれまでどおり詳細確認のみで、一覧要求を送りません。
盤面revision・処理段階・同期状態が変わった場合はダイアログを閉じます。
閉じた後の遅延応答、別試合、古いrevision/generationの応答は一覧へ反映しません。
通常オンライン対戦・一人回し・手動のテスト対戦の操作は変更しません。

## 一覧からの発動要求

`new EffectMatchOwner(match, catalog, true)` の明示指定が必要です。省略時は参照専用です。
`test-effect:command` に `kind: "activateRegistered"` を送信します。要求は通常の
matchId・現在のresolutionId・requestId・両revisionに加え、source参照、catalogVersion、effectIdです。
actor、処理定義、検証ルール等はクライアントから受け取りません。

自分の表向き盤面、登録カードと効果IDの対応、generation、カタログ版、両revision、
置き換え元のresolutionId、起動タイミング、発動条件をサーバーで再確認します。
対象は待機状態、または未開始・完了済みでgateがidleの効果だけです。コスト選択・支払い待ち・解決途中は拒否します。
新しい実行器を別に構築してコスト選択の開始まで検証し、成功時だけ差し替えます。
失敗しても元の効果と盤面は保持します。効果切替だけでカードやDONは移動しません。
移動ルールと数値評価方針は、待機セッションまたは直前の実行器を作成した信頼するサーバー設定を引き継ぎます。

同じrequestId・内容の再送は、プレイヤー別の記録から現在のviewを返し、再発動しません。
内容変更は拒否します。記録は各プレイヤー1024件までで、上限後は新規要求を拒否します。
発動要求の記録は解決単位ではなく対戦所有者に保持し、次の効果へ進んでも消しません。
通常の効果操作とは別の記録領域です。成功時は既存の通信経路で両者に各自のviewを配信します。
回数制限など実カード固有のルール全般を保証する実装ではなく、実カード能力はまだ登録していません。

## 効果のない待機状態

サーバーがadopt後に `prepareRegisteredIdle(rules, numericPolicy?)` を明示的に呼ぶと、
実行器を作らずに盤面・進行状態・公開範囲別のviewを保持できます。起動時の空効果は不要です。
この設定にはカタログと発動許可が必要で、通常の所有者の動作は変更しません。

通信上の `effect.status: "idle"` は実行中の効果がないことを表します。
この間の `resolutionId` はサーバーが予約した「次の解決」のIDです。
snapshotのactiveResolutionIdはnull、selectionはnull、completedStepsは0です。
actorは待機中の手番プレイヤーを表し、手札等の公開範囲は既存の投影に従います。
一覧からの発動が成功したときだけ、この予約IDで実行器とコスト選択を開始します。
待機中に通常のstart/advance等を送っても処理は開始しません。

OwnedEffectEndpoint経由の処理完了後、および成功した支払い前のcancelCosts後は、
実行器を解放し、結果の盤面を保持して待機へ戻ります。次の予約IDは更新します。
支払い済み・解決中・失敗で停止した効果は自動解放しません。
終了した解決への通常コマンドは拒否し、発動要求の再送記録は保持して再発動を防ぎます。
待機からの参照・同期・次の発動も同じSocket所属チェックを通ります。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/effect-catalog.cjs test/local-effects.cjs
```
