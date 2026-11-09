# PR14b: 手札破棄を伴うKO置換

## 対応範囲

- 隔離v3で、公開キャラ自身の単一の効果KOを、操作者自身の手札のイベントまたはステージ1枚をトラッシュに置く処理へ任意で置き換えられる。対象キャラは移動せず、世代も変わらない。効果の残りは既存Runtimeから再開する。
- DSLはルートの `replacementEffects` に `REPLACE_EVENT` を指定し、`match.cause: "EFFECT_KO"` と `substitute: {"type":"PREVENT"}` に `optionalPayment` を組み合わせる。支払いの形状はPR10の `MOVE_AS_COST`（自分の非公開手札・1枚・トラッシュ・種別がイベント／ステージのみ）を再利用する。追加の手札フィルターや複合支払いは未対応。[命令一覧と例](card-effect-supported-operations.json)
- [公式EB01 Q&A](https://en.onepiece-cardgame.com/pdf/qa_eb01.pdf?20240419=)に従い、対象の手札がなければ置換はできない。[総合ルール 8-1-3-4](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)に従い、実際の破棄は置換効果の操作者による `EFFECT_MOVE` として記録する。元効果の発動コスト `COST_PAYMENT`、元のKOとは区別する。
- 同一キャラ・同一操作者の支払い付き置換だけを、同じKOに対する代替候補として選択可能にした。候補と支払いカードを1トークンで紐付ける。無償置換との競合、複数発生元の順序、連鎖・同時対象は扱わない。

## 選択・確定

1. PR14aの移動意図と耐性判定を再利用。既存の条件・コスト候補評価から支払い可能な手札を取得し、署名付きフレームに保存する。盤面は未変更。
2. 選択肢を操作者だけに投影する。支払い候補が0枚でも同じ待機を相手に投影し、支払い可否・カード・候補数を開示しない。手札の種別がUNKNOWNなら支払いを提示せず、UNKNOWNのまま保持する。操作者が辞退した場合だけ通常のKOに進む。
3. chooser、期限、revision、選択tokenを既存の応答処理で検証。再開時に元の意図と候補・世代を照合し、PR10の支払い可否を再検証する。辞退なら破棄せず元KOを適用する。承認なら元KOを実行せず、破棄だけを同じMovementStoreで適用する。
4. 移動・誘発検証・適用済み記録を同じ確定境界で扱う。破棄由来の誘発だけが発生し、その原因は置換のrule IDに帰属する。失敗時は破棄・KO・適用済み記録を公開しない。同一要求の再送で再適用しない。

## 互換性・保留

- Schema `3.0.0-subset.38`、Compiler `v3-subset-compiler.38.1`、Registry SHA-256 `ad83fc5f516b830359f5bb9980488c75278c453cb275e31429f4ee7afa11b77b`。新プロファイルだけ `replacement:REPLACE_EVENT@2`。生成Schema SHA-256（LF）: `abf09202eb2c35eaf7e299e6daca49e05f000fcec09122913e0ec56d93abec56`。
- 旧subset.16〜37と既存14枚の承認manifestは変更しない。通常対戦・一人回しは変更なし。EB01-008のターン1回制限はPR14cのため、実カード定義の追加・承認は行わず、破棄置換のみ合成fixtureで検証した。
- 複数発生元の競合、回数制限、同時対象、連鎖、戦闘・ルール由来の置換、サーバー再起動後の復旧は対象外。

## 検証と変更ファイル

- 関連13件、全回帰915件成功（失敗・スキップ0）。フロント・サーバービルド成功。
- 集計: 23ファイル（新規7、既存16）、全体+8971/-170行、生成物を除き+498/-96行、実行ソース+202/-95行。PR10の手札絞り込みと移動生成、PR14aの意図・署名付き選択・確定を再利用し、独立した解決器は追加していない。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`replacementPlans.ts`、`activationCosts.ts`、`fixtureEnvironment.ts` |
| Coordinator・通信 | `server/src/test/effects/v3/fixtureCoordinator.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts`、`conditionalTriggers.ts` |
| 隔離対戦UI | `src/testMatch/V3ChoicePanel.tsx`、`V3SessionPanel.tsx` |
| テスト | `server/test/v3-paid-replacement.cjs`、`tools/test-v3-paid-replacement-schema.test.js` |
| 生成・検証 | `tools/build-v3-paid-replacement-schema.js`、`tools/build-v3-paid-replacement-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset38.schema.json`、`docs/card-effect-paid-replacement.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr14b.md` |
