# PR10a: 条件付き発動コストと一括支払い

対象は隔離v3のみ。通常対戦・一人回し、既存14枚の承認manifest、フロントの操作や通信形式は変更なし。

## DSL

- `REVEAL_CARDS@1` : `{ "type": "REVEAL_CARDS", "selector": { ... } }`。選んだ自分の手札を、その解決の公開スコープ内で両者に公開する。手札からは移動しない。
- `MOVE_AS_COST@1` : `{ "type": "MOVE_AS_COST", "selector": "SOURCE", "destination": "trash" }`。自分の公開されたキャラクターまたはステージの発動元自身をトラッシュへ移す。手札を条件付きで破棄する場合は、`selector` に以下と同じ形式を指定する。KOや効果による移動ではない。
- 手札用 `selector` は既存の `CARDS`、既存の条件・メタデータ判定を使う。`min === max > 0`。手札のカード種類は character / stage / event。1効果につき条件付き手札コスト1個と発動元移動1個まで。発動元のレストと移動は併用不可。

```json
{
  "type": "REVEAL_CARDS",
  "selector": {
    "type": "CARDS",
    "owner": "SELF", "controller": "SELF", "chooser": "SELF",
    "zone": "hand", "cardTypes": ["event", "character", "stage"],
    "filters": {
      "type": "any",
      "conditions": [
        { "type": "compare", "left": { "ref": "CANDIDATE.cardType" }, "op": "eq", "right": "event" },
        { "type": "CARD_METADATA", "subject": "CANDIDATE", "basis": "PRINTED", "field": "traits", "match": "ANY", "comparison": "EXACT", "values": ["パンクハザード"] }
      ]
    },
    "excludeSource": false, "faceUpOnly": false, "min": 3, "max": 3,
    "visibility": "OWNER_ONLY", "selectionMode": "SELECT", "order": "UNORDERED", "onInsufficient": "fail"
  }
}
```

## 実行と公開

1. 発動条件を確認し、候補の権限、世代、領域、フィルター、総支払い可能数を検証。任意発動は既存の `optional: true` で辞退できる。UNKNOWNを支払可能に変換しない。
2. 条件付き手札、通常の手札破棄、DON返却の順に必要な選択を行う。選択は署名付き解決フレームに保存され、候補は選択者だけに投影する。この間、盤面と公開情報は変えない。既存のロック、revision、再送対策を使う。
3. 選択を再検証し、既存の `PAY_COSTS` と移動トランザクションで全コストを一括確定する。同じカードを複数のコストに使えない。発動元移動に伴う付与DONの自動移動はルール処理で、DON返却コストに重ねない。独立した支払いエンジンは追加していない。
4. 確定した公開カードだけを両者に表示し、後続の効果を共通Runtimeで解決する。公開は解決終了時に閉じる。解決条件が不成立でも公開は閉じ、確定済みコストは戻さない。移動イベントは既存誘発キューに渡す。

根拠: [公式総合ルール 8-4-1-3](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240419=) の発動コストの一括支払い。代表パターンは [EB05-007](https://en.onepiece-cardgame.com/cardlist/?series=569205) の条件付き公開と [EB01-013](https://en.onepiece-cardgame.com/cardlist/?series=569201) の自身の破棄を参照し、カード全体ではなく合成fixtureで検証した。

## 互換性と保留

- Schema `3.0.0-subset.30` / Compiler `v3-subset-compiler.30.1` / Registryは2コストを追加し、既存ハンドラーのバージョンは不変。
- Registry SHA-256: `c7b008458ad6bf0ce3804cb173aec5676dc57ef2568eb6adc876afd3b67c5bc5`
- 生成Schema SHA-256（LF）: `8cf3af93afea704b8f4b97b77a9b28178436b86d370b546dcf4f734ace872083`
- 旧subset.16〜29のCompilerバージョン、Registry hash、既存14枚の承認を維持。新規の実カード承認なし。
- モード選択、効果処理内の任意支払い・結果分岐はPR10b。手札・発動元以外の移動コスト、トラッシュ以外への支払い移動、同一カードを重ねて使う複合コスト、支払ったカードを後続効果へ束縛するDSL、イベント・ライフトリガーへの追加発動コストは未対応。公開確定後の安全停止の復旧は既存と同じく未対応。

## 検証と変更ファイル

- 関連7件、全回帰870件成功（失敗・スキップ0）。フロント・サーバービルド成功。既存テストの削除・スキップ変更なし。
- 集計: 19ファイル（新規8、既存11）、全体+7048/-120行、生成物を除き+470/-56行、サーバー実行ソース+141/-55行。生成物はSchema2、型コピー、命令一覧。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/activationCosts.ts`、`compiler.ts`、`dsl.ts`、`resolution.ts` |
| Coordinator・読み取り | `server/src/test/effects/v3/fixtureCoordinator.ts`、`fixtureEnvironment.ts`、`matchCoordinator.ts`、`conditionalTriggers.ts` |
| テスト | `server/test/v3-activation-costs.cjs`、`tools/test-v3-activation-costs-schema.test.js` |
| 生成・検証 | `tools/build-v3-activation-costs-schema.js`、`tools/build-v3-activation-costs-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset30.schema.json`、`docs/card-effect-activation-costs.schema.json`、`docs/card-effect-types.ts.txt`、`docs/card-effect-supported-operations.json` |
| 資料 | `docs/card-effect-pr10a.md`、`docs/card-effect-implementation-roadmap.md` |
