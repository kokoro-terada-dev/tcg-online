# PR11a: 相手本人による手札の選択と破棄

対象は隔離v3のみ。通常対戦・一人回し、既存14枚の承認manifest、旧Schemaと旧Registry hashは変更しない。

## DSL

```json
{ "type": "DISCARD_BY_OWNER", "player": "OPPONENT", "chooser": "OPPONENT", "count": 1 }
```

- `player` は手札の持ち主、`chooser` は回答するプレイヤー。いずれも効果操作者から見た相手に限定する。効果操作者は移動の原因・後続処理の操作者として維持される。
- `count` は1〜50の整数。要求数より手札が少なければある分をすべて選び、手札0枚なら選択も移動もせず次へ進む。これは解決中の効果で、最低枚数を要求する発動コストには使えない。
- 私的な候補選択とトラッシュ移動を1命令にまとめる。通常のSELECTや対象bindingに相手手札を渡さない。フィルター、選択省略、ランダム、盲選択、非公開領域への移動、順序指定は扱わない。

公式根拠: [総合ルール](https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240426=) の3-5-2（トラッシュの公開）、8-4-4-1（選択枚数が足りない場合）、10-2-14-1（手札の破棄）。[EB02-045](https://en.onepiece-cardgame.com/cardlist/?series=569202) の破棄部分を参照した合成fixtureで検証した。[EB04-022](https://asia-en.onepiece-cardgame.com/cardlist/?series=556204) のデッキ下への順序付き移動はPR11b。

## 処理と公開境界

1. 共通Runtimeが相手の手札から領域・所有者・操作者・本人の閲覧権限を検証して候補を作り、既存の署名付き解決フレームで待機する。本人のビューだけに候補のカードID・token・対応する画像別名を投影する。効果操作者のUIは待機表示にする。
2. 回答時に署名フレーム・revision・座席・選択ID・枚数・tokenを照合し、選ばれた個体と世代を再検証する。回答後のwork待機中にも、候補・回答・内部参照は公開しない。同期、イベント配信、エラー応答は既存の座席別投影を使い、生の手札や内部workをログ出力しない。
3. 選択結果は既存Coordinatorの1トランザクションで相手の手札から相手のトラッシュへ移動する。公開されるトラッシュへの追加順はカードID・個体IDで決め、私的な手札の並びや回答順は使わない。
4. 移動確定後に初めて選ばれたカードが公開される。効果操作者を原因とする `EFFECT_MOVE` を既存の誘発処理へ渡す。KO・コストではない。同じ回答や確定を再送しても同じ移動を繰り返さない。

## 互換性・保留

- Schema `3.0.0-subset.32`、Compiler `v3-subset-compiler.32.1`、Registry SHA-256 `07cb8f50e006b1c38ee062bf9fd2efde61373851f4d608a01652fc7544ee56b1`。
- 生成Schema SHA-256（LF）: `77cc164b6861265380065112fc6b3a8e7a376326b6b3c42bab3045cc2627ff7b`。
- 旧subset.16〜31のハッシュ・バージョンを維持。新規実カードの承認なし。EB02-045に必要なトラッシュからデッキ下へ戻す発動コストは今回の対象外。
- 裁定未確認の複数枚移動での誘発順序、手札フィルター、非公開領域への移動・順序指定、盲選択・ランダム、再起動をまたぐ復旧は未対応。UNKNOWNは候補不足とみなさず、既存の安全停止を使う。

## 検証・変更ファイル

- 関連4件（うち2端末・第三者でのSocket.IO検証1件）、全回帰880件成功（失敗・スキップ0）。フロント・サーバービルド成功。既存テストの削除・変更なし。
- 集計: 24ファイル（新規8、既存16）、全体+7236/-111行、生成物を除き+378/-43行、実行ソース+121/-42行。生成物はSchema2、型コピー、命令一覧。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`simpleMainEvent.ts` |
| Coordinator・通信 | `server/src/test/effects/v3/conditionalTriggers.ts`、`fixtureCoordinator.ts`、`fixtureEnvironment.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts`、`ownerDiscard.ts` |
| UI | `src/testMatch/V3ChoicePanel.tsx`、`V3FixtureLobby.tsx`、`V3SessionPanel.tsx` |
| テスト | `server/test/v3-owner-discard.cjs`、`tools/test-v3-owner-discard-schema.test.js` |
| 生成・検証 | `tools/build-v3-owner-discard-schema.js`、`tools/build-v3-owner-discard-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset32.schema.json`、`docs/card-effect-owner-discard.schema.json`、`docs/card-effect-types.ts.txt`、`docs/card-effect-supported-operations.json` |
| 資料 | `docs/card-effect-pr11a.md`、`docs/card-effect-implementation-roadmap.md` |
