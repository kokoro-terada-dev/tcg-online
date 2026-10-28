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
利用者がカードをタップして登録済み効果一覧から選ぶ通信/UI、実カード定義、
ファイル配置・読込・マスターとの配布管理は今後の段階です。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/effect-catalog.cjs test/local-effects.cjs
```
