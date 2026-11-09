# PR11b: 相手本人の順序指定によるデッキ下への移動

隔離v3のみ。通常対戦・一人回し、既存14枚の承認manifest、旧Schemaと旧Registry hashは変更しない。

## DSL

```json
{ "type": "ORDER_THEN_MOVE", "player": "OPPONENT", "chooser": "OPPONENT", "count": 2, "destination": "deckBottom" }
```

- `player` は手札・デッキの持ち主、`chooser` は選ぶ側。どちらも効果操作者から見た相手に限定する。トークン回答の先頭が追加した束の一番上、末尾がデッキの一番下になる。
- `count` は1〜50の整数。足りなければある分をすべて選び、0枚なら選択を出さない。任意選択・フィルター・参照binding・デッキ上への移動はこの命令に含めない。
- [EB04-022の公式カードリスト](https://asia-en.onepiece-cardgame.com/cardlist/?series=556204) の手札2枚を持ち主の好きな順番でデッキ下へ戻す部分を参照。枚数不足は [公式総合ルール](https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240426=) 8-4-4-1に従う。今回の検証は合成fixtureのみ。

## 処理と公開境界

1. PR11aと同じ候補検証と座席別投影を使う。手札の持ち主にだけ候補カード・画像別名・tokenを送る。選択側では選択順を番号で示し、相手には待機状態だけを示す。
2. 共通の署名フレーム・revision・選択ID・座席・枚数・tokenの検証を通し、回答順の個体参照をサーバーに保持する。回答時とwork確定時に世代、領域、所有・操作権限を再検証する。同じ要求の再送で再確定しない。
3. 既存の移動トランザクション1回で、回答順に裏向きでデッキ下へ追加する。カードを公開せず、既存デッキの並びと残った手札の並びを変えない。移動後の旧世代参照は無効。
4. 効果操作者を原因とする `EFFECT_MOVE` を既存の誘発処理に渡す。相手への公開ログは件数だけに集約し、カードID・個体・順序を含めない。前状態を参照できる持ち主側の誘発でも、非公開カードの一致・不一致を外部へ推測させないようUNKNOWNとして保留する。

## 互換性・保留

- Schema `3.0.0-subset.33`、Compiler `v3-subset-compiler.33.1`、Registry SHA-256 `6586f83bdeb67aa7cc90c1b45e8d5460053a32de34582938c5a070961150ff35`。
- 生成Schema SHA-256（LF）: `94e681c744de741f3dd722d19047fffb84566786b6652315db1237711824c774`。旧subset.16〜32のハッシュ・バージョンを維持。
- 盲選択・ランダム処理、非公開カードの正体に依存する誘発の自動解決、再起動をまたぐ復旧は対象外。EB04-022を含む実カードの新規承認は行っていない。PR12以降は未着手。

## 検証・変更ファイル

- 関連9件（PR11a回帰を含む）、全回帰885件成功（失敗・スキップ0）。フロント・サーバービルド成功。既存テストの削除・変更なし。
- 集計: 24ファイル（新規8、リネーム1、その他15）、全体+7270/-138行、生成物を除き+338/-69行、実行ソース+86/-68行。生成物はSchema2、型コピー、命令一覧。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`simpleMainEvent.ts` |
| Coordinator・通信 | `server/src/test/effects/v3/conditionalTriggers.ts`、`fixtureCoordinator.ts`、`fixtureEnvironment.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts`、`ownerDiscard.ts` → `ownerHand.ts` |
| UI | `src/testMatch/V3ChoicePanel.tsx`、`V3FixtureLobby.tsx`、`V3SessionPanel.tsx` |
| テスト | `server/test/v3-owner-deck-bottom.cjs`、`tools/test-v3-owner-deck-bottom-schema.test.js` |
| 生成・検証 | `tools/build-v3-owner-deck-bottom-schema.js`、`tools/build-v3-owner-deck-bottom-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset33.schema.json`、`docs/card-effect-owner-deck-bottom.schema.json`、`docs/card-effect-types.ts.txt`、`docs/card-effect-supported-operations.json` |
| 資料 | `docs/card-effect-pr11b.md`、`docs/card-effect-implementation-roadmap.md` |
