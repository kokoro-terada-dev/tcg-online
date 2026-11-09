# PR14a: 移動確定前の置換意図

## 対応範囲

- 隔離v3の `KO`／`MOVE_CARD` による単一の効果移動が対象。公開・表向きで、所有者自身が操作しているキャラクターが、自身に対する元の処理を任意で置き換えられる。置換先は自分の手札かトラッシュ。置換コスト・回数制限は未対応。
- `CardDefinition.replacementEffects` に `REPLACE_EVENT` を記述。例は [命令一覧](card-effect-supported-operations.json) を参照。CompilerはID、移動元・移動先・原因、公開盤面と印刷値を使う安定した条件式の範囲を検証する。JSON Schemaの形状検証だけで対応可否を確定しない。
- 効果KOと通常の効果移動を別扱いにする。通常の移動は、同じ移動先への置換を禁止。効果KOを通常のトラッシュ移動に置き換える場合はKOとして扱わない。
- 公式の[総合ルール 8-1-3-4](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)の任意選択、元処理と代替処理の区別、代替処理が可能であること、置換効果側への原因帰属に沿う。複数候補の順序はここでは実装しない。

## 確定境界

1. 元のworkから、対戦・盤面revision・work・発動元・対象の個体と世代・効果ID・原因・移動元と移動先を含む不変の意図を作る。既存の耐性判定を先に通し、置換条件は共通の条件評価・DerivedCardFactsを使う。実際にはまだ移動も誘発通知も行わない。
2. 単一の有効な候補について、元workと置換候補を既存の署名付きフレームに保存する。置換カードの操作者だけに承認・辞退の選択肢を提示する。相手には待機状態のみ表示し、内部の意図・候補ID・選択tokenを渡さない。
3. 選択のrevision・権限・token・有効期限を既存の応答処理で検証する。回答後に元の位置から再開し、世代と盤面revisionを含む意図と候補を再計算・照合する。再送は既存の受付記録で重複適用を防ぐ。
4. 辞退なら元の操作を実行。承認なら元の操作を渡さず、代替移動だけを同じMovementStoreに渡す。実際の移動を検証し、置換適用ID・移動・誘発通知を既存の確定点に接続する。元のKO通知・ON_KO・成功した元移動の記憶は残さない。置換後に発生した実際の移動だけが通知対象になる。
5. UNKNOWN・複数の有効候補・連鎖する可能性がある置換・置換を含む複数対象workは、安全停止する。未確定の移動は適用しない。MovementRulesの `defer` は非同期選択に流用しない。

## 互換性と保留

- Schema `3.0.0-subset.37`、Compiler `v3-subset-compiler.37.1`、Registry SHA-256 `822223dbb3aaf5bae763432e7a4993bdc74da7b558b57eecf1c6b710e6fb8808`。追加は `replacement:REPLACE_EVENT@1` のみ。生成Schema SHA-256（LF）: `fe3c9066248478cb77093f7a5b8a51c9eb7b263e3d344edde79057b97f240d16`。
- 旧subset.16〜36のRegistry hashと承認manifestを変更していない。既存14枚の承認を維持。新規承認はなく、検証は合成fixtureのみ。通常対戦・一人回しは変更なし。
- PR14bの任意支払い、PR14cの同時対象・複数置換の順序・連鎖・回数制限、戦闘／ルール由来の置換は未対応。既存の安全停止からの復旧とサーバー再起動をまたぐ永続化も対象外。

## 検証と変更ファイル

- 関連7件、全回帰909件成功（失敗・スキップ0）。フロント・サーバービルド成功。
- 集計: 22ファイル（新規8、既存14）、全体+8745/-124行、生成物を除き+536/-51行。製品実行ソースは+236/-50行。既存解決器の書き換えや移動処理の複製はなく、待機・応答・確定の既存経路を再利用。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`replacementPlans.ts`、`moveResults.ts` |
| Coordinator・通信 | `server/src/test/effects/v3/fixtureCoordinator.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts`、`conditionalTriggers.ts` |
| 隔離対戦UI | `src/testMatch/V3ChoicePanel.tsx`、`V3SessionPanel.tsx` |
| テスト | `server/test/v3-replacement.cjs`、`tools/test-v3-replacement-schema.test.js` |
| 生成・検証 | `tools/build-v3-replacement-schema.js`、`tools/build-v3-replacement-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset37.schema.json`、`docs/card-effect-replacement.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr14a.md` |
