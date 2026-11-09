# PR12b: 基礎値の設定とカウンター値

隔離v3のみ。通常対戦・一人回し、既存14枚の承認manifest、旧Schemaと旧Registry hashは変更しない。

## DSL・読み取り

| `CONTINUOUS_EFFECT` の操作 | 契約 |
| --- | --- |
| `{ "type": "SET_BASE_STAT", "stat": "power", "value": 8000 }` | 場のリーダー・キャラの基礎パワーを設定する。 |
| `{ "type": "SET_BASE_STAT", "stat": "cost", "value": 3 }` | 場のキャラ・ステージの基礎コストを設定する。 |
| `{ "type": "ADD_STAT", "stat": "counter", "amount": 1000 }` | 数値が確定しているカウンターに加算する。印刷なしのカードへ加算するだけでは新しいカウンターは生じない。 |
| `{ "type": "GRANT_COUNTER", "value": 1000 }` | 承認済み定義が印刷カウンターなしを明示しているキャラにのみ、カウンター値を与える。 |

- カウンターの対象は表向きの場のキャラ、または発生源の操作者本人の手札のキャラに限定する。手札を選ぶDSLや情報公開範囲は拡張しない。
- 通常の条件・セレクターで `SOURCE` / `CANDIDATE` の `printed`（印刷値）、`base`（基礎値）、`current`（現在値）の各 `power` / `cost` / `counter` を区別して読める。既存の `SOURCE.power` 等は現在値のまま。
- 継続効果の条件は引き続き変更されない入力のみ。例えば `CANDIDATE.printed.power` や `CANDIDATE.printed.counter == null` を使える。補正後の `base` / `current` を条件にするとCompilerが拒否する。

## 合成と再評価

1. 印刷値を保持し、独立した複数の基礎パワー・基礎コスト設定が有効なら、そのうち最も高い設定値を使う。印刷値との最大値ではない。根拠は [公式総合ルール](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=) 4-9-2〜4-9-2-2。
2. 基礎値に継続加算、期限付き補正、パワーに対するDON・戦闘中のカウンターボーナスを合成する。基礎値そのものや定義は書き換えず、PR12aと同じ確定盤面・手番から再評価する。
3. カウンターの印刷なし（`null`）、数値0、UNKNOWNを区別する。資料なしを「印刷なし」と見なさない。複数のカウンター付与や未確定の設定、算出不能な値は推測せずUNKNOWNにする。負のカウンター値の扱いは確定していないため、算出結果が負になる場合も保留する。
4. 条件判定、戦闘パワー、カウンター候補と使用時の再検証は共通のDerivedCardFactsを使う。変更がある公開カードは基礎値と現在値を表示し、手札の変更後カウンター値は使用できる本人の候補にのみ表示する。

[EB01-001](https://asia-en.onepiece-cardgame.com/cardlist/?series=556201) の印刷カウンターなしの付与と、[OP17-112](https://cp.onepiece-cardgame.com/flame-flame-fruit/report) の基礎パワー変更に対応するパターンを合成fixtureで検証した。実カードの残りの効果を推測したり、承認したりしていない。

## 互換性・保留

- Schema `3.0.0-subset.35`、Compiler `v3-subset-compiler.35.1`、Registry SHA-256 `62763fa2904fae291db5af7940bfd1574aa0276c9eea63c306634ea3b5b44b32`。新プロファイルだけ `CONTINUOUS_EFFECT@2` を登録する。
- 生成Schema SHA-256（LF）: `f74b0f55beb209cf1a61039355f5b2a45cf5f9200cb9038a110647ca84229bb0`。旧subset.16〜34のハッシュ・バージョンを維持。
- 未対応: 基礎値設定・カウンター変更の期限付き命令、補正済みの値に依存する継続効果とその循環、複数カウンター付与の裁定、デッキ等でのカウンター値変更、PR13以降。手札からカードを使用する際の印刷コストは変更しない。

## 検証・変更ファイル

- 関連17件（PR12aと既存カウンター回帰を含む）、全回帰896件成功（失敗・スキップ0）。フロント・サーバービルド成功。
- 集計: 23ファイル（新規7、既存16）、全体+7913/-153行、生成物を除き+417/-80行、実行ソース+141/-79行。生成物はSchema2、型コピー、命令一覧。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`continuousEffects.ts`、`readContext.ts` |
| Coordinator・戦闘・通信 | `server/src/test/effects/v3/battle.ts`、`conditionalTriggers.ts`、`fixtureCoordinator.ts`、`fixtureEnvironment.ts`、`matchCoordinator.ts`、`sessionProtocol.ts` |
| UI | `src/testMatch/V3SessionPanel.tsx` |
| テスト | `server/test/v3-base-counter.cjs`、`tools/test-v3-base-counter-schema.test.js` |
| 生成・検証 | `tools/build-v3-base-counter-schema.js`、`tools/build-v3-base-counter-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset35.schema.json`、`docs/card-effect-base-counter.schema.json`、`docs/card-effect-types.ts.txt`、`docs/card-effect-supported-operations.json` |
| 資料 | `docs/card-effect-pr12b.md`、`docs/card-effect-implementation-roadmap.md` |
