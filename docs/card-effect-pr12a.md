# PR12a: 条件付き継続加算とキーワード

対象は隔離v3のみ。通常対戦・一人回し、既存14枚の承認manifest、旧Schemaと旧Registry hashは変更しない。

## DSL

`CardDefinition.continuousEffects` に1〜8個の `CONTINUOUS_EFFECT@1` を定義する。起動・誘発用の `effects[].actions` では使わない。例は [公式カードリスト OP16-080](https://asia-en.onepiece-cardgame.com/cardlist/?series=556116) のコスト補正部分に対応するが、実カードの定義・承認ではない。

```json
{
  "type": "CONTINUOUS_EFFECT",
  "condition": { "type": "TURN_IS", "player": "OPPONENT" },
  "affectedQuery": {
    "type": "QUERY_CARDS", "owner": "SELF", "controller": "SELF",
    "zone": "character", "visibility": "PUBLIC", "faceUpOnly": true,
    "cardTypes": ["character"], "filters": { "type": "all", "conditions": [] }, "excludeSource": false
  },
  "operation": { "type": "ADD_STAT", "stat": "cost", "amount": 1 }
}
```

- `ADD_STAT` は場のパワー・コストへの符号付き加算。パワーはリーダー・キャラクター、コストはキャラクター・ステージが対象。`GRANT_KEYWORD` は既存の `keyword: { type: ... }` を使い、ブロッカー、速攻、キャラ限定速攻、ブロック不可を付与できる。リーダーに速攻は付与しない。
- 発生源は表向きで両者が閲覧できるリーダー・キャラ・ステージ。発生源の操作者を基準に条件と対象を評価する。有効期間は場に存在し条件が成立している間。開始・終了時の作業命令や期限付き台帳への書き込みは行わない。
- 条件には手番、公開領域の枚数、公開カードの状態・印刷値・印刷された特徴や能力などを使用できる。非公開集合の照会、変更後の数値・付与後の能力、解決中のbindingへの依存はCompilerで拒否する。

## 再評価と統合

- [公式総合ルール](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=) 8-1-3-3に沿い、確定した盤面と現在の手番を読む時点で適用を判定する。発生源の移動・世代交代、手番や条件の変化で失効する。読み取り側で確定盤面ごとにキャッシュし、再開・再送で補正を積み増さない。
- EventContextで発生源を識別し、既存の条件評価とDerivedCardFactsを再利用する。継続効果の評価では継続補正自体を読まない。未確定の条件は対象の補正・能力をUNKNOWNとし、0や能力なしに置換しない。別の効果で既に同一能力が確定していれば、付与済みとして扱う。
- 期限付き補正と継続加算を同じ読み取りで合成する。盤面表示、選択・集合条件、戦闘値と攻撃・ブロック候補に反映する。印刷値、盤面外のコスト、手札から登場・使用する際の印刷コストは変えない。

## 互換性・保留

- Schema `3.0.0-subset.34`、Compiler `v3-subset-compiler.34.1`、Registry SHA-256 `0fe0489f942a8b6f38c9851bd2cab2fb1ccb09a3be3d656c3fa22209aa006510`。
- 生成Schema SHA-256（LF）: `dc7c0aa2f406f282d3154bfbc928397077a1a084414b467183ebf3dd2bd3f9c5`。旧subset.16〜33のハッシュ・バージョンを維持。
- 基礎値の上書き・カウンター値、非公開領域への常在効果、補正同士の依存・適用順、能力無効化などの制限は未対応。OP16-080の攻撃先変更を含め実カードの新規承認は行っていない。PR12b以降は未着手。

## 検証・変更ファイル

- 関連25件（既存Facts・期限管理の回帰を含む）、全回帰891件成功（失敗・スキップ0）。フロント・サーバービルド成功。
- 集計: 23ファイル（新規8、既存15）、全体+7762/-150行、生成物を除き+504/-80行、実行ソース+226/-79行。生成物はSchema2、型コピー、命令一覧。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`continuousEffects.ts`、`readContext.ts` |
| Coordinator・戦闘・通信 | `server/src/test/effects/v3/battle.ts`、`conditionalTriggers.ts`、`fixtureCoordinator.ts`、`fixtureEnvironment.ts`、`matchCoordinator.ts`、`sessionProtocol.ts` |
| UI | `src/testMatch/V3SessionPanel.tsx` |
| テスト | `server/test/v3-continuous.cjs`、`tools/test-v3-continuous-schema.test.js` |
| 生成・検証 | `tools/build-v3-continuous-schema.js`、`tools/build-v3-continuous-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset34.schema.json`、`docs/card-effect-continuous.schema.json`、`docs/card-effect-types.ts.txt`、`docs/card-effect-supported-operations.json` |
| 資料 | `docs/card-effect-pr12a.md`、`docs/card-effect-implementation-roadmap.md` |
