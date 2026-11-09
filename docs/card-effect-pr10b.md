# PR10b: モード選択と効果内の任意支払い

対象は隔離v3のみ。通常対戦・一人回し、既存14枚の承認manifest、旧Schemaと旧Registry hashは変更しない。

## DSL

| 命令 | 契約 |
| --- | --- |
| `CHOOSE_MODE@1` | 効果操作者が `modes: [{ label, actions }]` から1つ選ぶ。2〜8個、ラベルは重複しない。選ばれなかった分岐は実行しない。 |
| `OFFER_PAYMENT@1` | 到達した時点で `costs` を検証し、支払える場合だけ本人に提示する。結果を `bindAs` に記録。PR10aと同じコストノードと組み合わせ制約を使う。 |
| `IF_PAYMENT_SUCCEEDED@1` | 先に同じスコープまたは親スコープで記録した `payment` の結果を参照し、`then` または `else` を解決する。分岐の外には分岐内で作った結果を持ち出せない。 |

合成例: 以下はカード定義の `actions` であり、実カードではない。

```json
[
  { "type": "CHOOSE_MODE", "modes": [
    { "label": "1枚引く", "actions": [{ "type": "DRAW", "player": "SELF", "count": 1 }] },
    { "label": "追加コストを支払って2枚引く", "actions": [
      { "type": "OFFER_PAYMENT", "bindAs": "extra", "costs": [{ "type": "REST_DON", "count": 1 }] },
      { "type": "IF_PAYMENT_SUCCEEDED", "payment": "extra", "then": [{ "type": "DRAW", "player": "SELF", "count": 2 }], "else": [] }
    ] }
  ] }
]
```

## 処理順序と安全性

1. モード選択は共通の署名付き解決フレームを使う。サーバーが発行したtokenを本人が1つ選び、選んだ分岐の先頭から再開する。相手には候補tokenやラベルを送らない。
2. 途中の支払いは到達時の盤面で評価する。明らかな不足、または提示時の辞退は未払いとして続行する。UNKNOWNや不正応答では未払い分岐を実行しない。発動そのものを辞退する `optional: true` や、イベント使用時の印刷コストとは別。
3. 受諾後の手札・DON選択、重複リソースの除外、選択時と確定時の再検証はPR10aと同じ経路を使う。選択中は非公開カードを相手へ送らず、盤面に支払いを反映しない。
4. `PAY_COSTS` を1つの移動トランザクションとして確定した場合だけ成功を記録する。revision・選択token・再送receiptを共用し、二重支払いと二重発動回数消費を防ぐ。確定失敗は安全停止とし、既に解決した別の効果を巻き戻さない。
5. 支払い後に対象不在などで効果の一部が不発でも、確定したコストを戻さない。公開は既存スコープ内で閉じ、発生したイベントは既存誘発キューで扱う。UIは既存選択パネルにモードと支払い内容を表示する。

## 互換性・保留

- Schema `3.0.0-subset.31`、Compiler `v3-subset-compiler.31.1`、Registry SHA-256 `2b395b4256880b579db05f427e681b65953c451f949363565ed63f670b42cdae`。旧subset.16〜30のRegistry hash・Compiler版を維持した。
- 生成Schema SHA-256（LF）: `32cd30ea16267d4c691a9b488caeea9c81b56d82b1cbbea7b0ae2972403da1ab`。
- [公式カードリスト EB02-045](https://en.onepiece-cardgame.com/cardlist/?series=569202) の「1つ選ぶ」パターンを参照。トラッシュからデッキ下へ戻す発動コストと相手本人の手札破棄は未対応で、カード全体は承認していない。新カードの自動承認は行っていない。
- PR11以降の非公開領域の相手選択、任意・複数モードの同時選択、PR10aで未対応の支払いリソース、裁定未確定の途中変更・置換、サーバー再起動をまたぐ復旧は対象外。検証した範囲はロック下で原子的に確定できる支払い。

## 検証・変更ファイル

- 関連13件、全回帰876件成功（失敗・スキップ0）。フロント・サーバービルド成功。既存テストの削除・変更なし。
- 集計: 21ファイル（新規8、既存13）、全体+7418/-140行、生成物を除き+511/-75行、実行ソース+207/-74行。生成物はSchema2、型コピー、命令一覧。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`simpleMainEvent.ts` |
| Coordinator・通信 | `server/src/test/effects/v3/conditionalTriggers.ts`、`fixtureCoordinator.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts` |
| UI | `src/testMatch/V3ChoicePanel.tsx`、`src/testMatch/v3Fixture.css` |
| テスト | `server/test/v3-mode-payment.cjs`、`tools/test-v3-mode-payment-schema.test.js` |
| 生成・検証 | `tools/build-v3-mode-payment-schema.js`、`tools/build-v3-mode-payment-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset31.schema.json`、`docs/card-effect-mode-payment.schema.json`、`docs/card-effect-types.ts.txt`、`docs/card-effect-supported-operations.json` |
| 資料 | `docs/card-effect-pr10b.md`、`docs/card-effect-implementation-roadmap.md` |
