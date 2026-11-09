# PR13: 原因別の耐性・保護

対象は隔離v3のみ。通常対戦・一人回し、既存14枚の承認manifest、旧Schemaと旧Registry hashは変更しない。

## DSL

`CONTINUOUS_EFFECT` の `operation` に `RESTRICT` を追加。保護先は `affectedQuery` が指定する自分側の公開された場のみ。既存の安定した条件を使い、条件が成立し発生源が場にいる間だけ有効。

| policy | 判定と効果 |
| --- | --- |
| `CANNOT_TARGET` | 効果の対象候補に含めない。選択回答時も再確認する。戦闘対象や条件の集合照会からは除外しない。 |
| `UNAFFECTED_BY` | 選択はできるが、相手からの効果移動・レスト/アクティブ変更、数値・キーワード付与を適用しない。相手の継続補正も合成しない。 |
| `CANNOT_KO` | キャラのKOのみ防ぐ。`cause: EFFECT` と `cause: BATTLE` は別。戦闘の場合は `sourceAttribute` で攻撃元の印刷属性を完全一致で指定できる。 |
| `PREVENT_MOVE` | 効果による領域移動を防ぐ。効果KOも領域移動として含む。移動以外の状態変更・補正は妨げない。 |

`by` は保護先の操作者から見た `SELF` / `OPPONENT` / `ANY`。`UNAFFECTED_BY` は循環を避けるため `OPPONENT` に限定する。選択する人と、効果を適用する操作者は別。

```json
{ "type": "RESTRICT", "policy": "CANNOT_KO", "by": "OPPONENT", "cause": "EFFECT" }
```

[EB03-018の公式カードリスト](https://asia-en.onepiece-cardgame.com/cardlist/?series=556203) の効果KO耐性、[OP03-008の公式カードリスト](https://asia-en.onepiece-cardgame.com/cardlist/?series=556103) の属性別戦闘KO耐性を参照。検証は合成fixtureのみ。

## 適用と再評価

- 既存の継続効果評価とDerivedCardFactsを使う。手番、盤面状態、発生源が変われば再評価し、選択済みでも処理の適用直前に最新の耐性を使う。
- 移動と状態変更は既存MovementStoreのルール判定に接続する。効果操作者と原因を区別し、コスト・ルール移動・付与DONの自動戻しには効果耐性を適用しない。戦闘KOだけは戦闘用の耐性で判定する。
- 混在する対象は保護されていないものだけ処理する。防いだ移動は成功移動やKOとして記録しない。移動結果の記憶と誘発も成功した移動だけを見る。防いだ戦闘KOで余分な誘発待機を作らない。
- 複数操作の途中で耐性判定が変わる場合は、順序を推測せずトランザクションを保留する。UNKNOWNは「耐性なし」に置き換えない。耐性を得る前に確定した相手の期限付き補正との競合もUNKNOWNとし、台帳を巻き戻さない。

## 互換性・保留

- Schema `3.0.0-subset.36`、Compiler `v3-subset-compiler.36.1`、Registry SHA-256 `91b2de0e16b0259393cc336c03c2ac0eb63ea3b468a8c813832abc97948b21cf`。新プロファイルだけ `CONTINUOUS_EFFECT@3`。
- 生成Schema SHA-256（LF）: `d946b7ac13de9ba2c9bdbd9bf5a91db2e61117465a064713bd3669a0c3fdab2e`。旧subset.16〜35のバージョン・ハッシュを維持。
- 置換効果、独立した期限付き耐性付与、発生源側の能力無効化、未確認の競合・順序は未対応。新規実カードの承認やPR14以降の実装は行っていない。

## 検証・変更ファイル

- 関連13件（継続・基礎値の回帰を含む）、全回帰902件成功（失敗・スキップ0）。フロント・サーバービルド成功。
- 集計: 23ファイル（新規8、既存15）、全体+8333/-144行、生成物を除き+506/-70行、実行ソース+227/-69行。生成物はSchema2、型コピー、命令一覧。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`continuousEffects.ts`、`readContext.ts` |
| Coordinator・移動・戦闘 | `server/src/test/effects/v3/protectionRules.ts`、`battle.ts`、`conditionalTriggers.ts`、`fixtureCoordinator.ts`、`fixtureEnvironment.ts`、`matchCoordinator.ts`、`moveResults.ts` |
| テスト | `server/test/v3-protection.cjs`、`tools/test-v3-protection-schema.test.js` |
| 生成・検証 | `tools/build-v3-protection-schema.js`、`tools/build-v3-protection-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset36.schema.json`、`docs/card-effect-protection.schema.json`、`docs/card-effect-types.ts.txt`、`docs/card-effect-supported-operations.json` |
| 資料 | `docs/card-effect-pr13.md`、`docs/card-effect-implementation-roadmap.md` |
