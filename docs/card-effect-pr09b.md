# PR09b 効果によるDON!!付与・返却

基準コミット: `dc63404`。ロードマップ09bのみ。PR10以降には進んでいません。

## DSL・互換性

- Schema `3.0.0-subset.29` / Compiler `v3-subset-compiler.29.1`。
- Registry 59登録。追加は `action:ATTACH_DON@1`、`action:RETURN_DON_BY_EFFECT@1`。新profileの `ON_EVENT@2` に `DON_RETURNED` を追加。
- Registry hash: `ca3158dc545180dbcbfec7d272b0a34c8ce287f933acea91ea7e9821bbb443e1`。
- Schema29のLFファイルSHA256: `a5e04e9619ba9629d743ab0b79ff0fe06586e24d79a62222d3debc9e8a9dfaa1`。
- 旧16〜28のSchema・Compiler版・Registry hashを維持。既存14枚の定義・承認manifestの変更、新規実カードの承認なし。

```json
{
  "type": "ATTACH_DON",
  "from": "REST",
  "assignments": [
    { "cards": { "ref": "bindings.firstDon" }, "target": { "ref": "bindings.leader" } },
    { "cards": { "ref": "bindings.secondDon" }, "target": { "ref": "bindings.character" } }
  ]
}
```

```json
{
  "type": "RETURN_DON_BY_EFFECT",
  "cards": { "ref": "bindings.don" },
  "from": ["activeDon", "restDon", "attachedDon"]
}
```

```json
{
  "type": "ON_EVENT",
  "event": "DON_RETURNED",
  "owner": "SELF",
  "cause": "EFFECT_MOVE",
  "min": 1
}
```

合成DSL例です。カード全文の変換ではありません。

- 付与のfromはACTIVEまたはREST。既存CARDSで束縛したDON!!と、CARDSまたはBIND_SOURCEで束縛した最大1枚の付与先を割当ごとに指定します。付与先は効果操作者自身が所有・操作する、表向きのリーダーまたはキャラクター。付与中のDON!!を別の付与先へ移す操作は未対応。
- 1割当で複数枚、または複数割当で異なる付与先に対応。全割当の最大枚数を合計10枚に制限し、同一個体を重複消費しません。割当内の順は既存CARDSのサーバー側候補順、割当間は記載順です。
- 返却は許可した自分のコストエリア/付与領域から、既存コスト処理と同じ内部順序でDON!!デッキ下へ移動。元の付与先を消し、裏向き・非レストにします。DON!!個体を作成・消去しません。
- 選択枚数は既存SELECTのmin/maxで指定。必須枚数不足は既存の選択拒否、明示された任意選択の0枚はno-op。DON!!があるのに付与先の選択がない場合は拒否します。

## 原子性と既存Runtime

1. 既存選択の本人・token・候補・世代・revisionを検証し、同じ署名付き解決frameにworkを保存。
2. Coordinatorで全対象の実体・世代・領域、所有者、操作者、公開状態とアクティブ/レスト、付与先を再検証。付与中のDON!!を返す場合も付与先の現在refを検証。
3. 正常時だけ既存MovementStoreの単一transactionとして確定。付与には既存attachDon、返却にはmoveを使用。効果用の明示的な付与元指定はeffectモードと操作者一致を要求し、通常のattachDonはアクティブ限定を維持。
4. 領域移動でDON!!の世代を更新し、古いrefを追跡しない。付与先が先に場を離れた場合、既存ルール処理でDON!!はレストへ戻り、古い付与先/DON!!のrefを使う次のworkは拒否。

選択待ち・work・イベント・request receiptの既存手続を再利用。対象不正・不足・重複で一部だけ確定しません。前段ですでに確定した別workや発動コストを巻き戻す機能ではありません。
通常対戦と一人回しのコードは変更せず、隔離v3のworkラベルを追加。非公開領域のカード情報、選択token、内部イベント証拠は既存の可視性境界を維持し、Socketへ新しい内部DTOは送信しません。

## イベントと返却誘発

- 付与・効果返却は、既存MovementEventの `moved` / `EFFECT_MOVE` として発動元・操作者・解決ID・前後の世代と領域を記録。レストDON!!を付与するために擬似的なアクティブ化を挟みません。
- 「ドン!!−N」の既存 `DON_RETURN` は発動コストの `PAY_COSTS` / `COST_PAYMENT` のまま。付与先離脱によるレストへの戻りは `RULE_PROCESSING` であり、DON!!デッキへの返却ではありません。
- DON_RETURNEDはowner SELF/OPPONENT、cause EFFECT_MOVE/COST_PAYMENT/ANY、min 1〜10枚を明示。実際に確定したトランザクション内の、同じ所有者・原因の公開領域からDON!!デッキへの返却を集約し、条件に合う候補を監視効果ごとに1件生成。
- 既存のON_EVENT観測台帳とEventContextを使い、枚数と原因の証拠をサーバー側に保持。判定は取引後の状態。候補の解決は既存誘発キューを通り、親解決へ割り込みません。
- 観測後に発動元が古くなった候補や、UNKNOWN/非公開条件は既存の安全停止経路を維持。付与・追加・状態変更・自動レスト戻しを返却として誤誘発させません。旧profileのON_EVENTにはDON!!の返却候補を追加しません。

## 公式ルールと保留

[公式総合ルール](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240419=) の6-2/6-5/8-6、[公式ルールマニュアル](https://onepiece-cardgame.com/pdf/rule_manual.pdf?20251201=) のドン!!−N、および[公式カードリスト](https://en.onepiece-cardgame.com/cardlist/?series=569201) のEB01-002を参照。通常付与、コスト、カード効果の指示を分離しています。
EB01-002のレストDON!!を付与する部分を合成fixtureで検証しましたが、カード全体の承認はしていません。今回の返却観測の単位は実装上明示した1work/トランザクションで、複数のworkをまたぐ集約や任意の個別裁定を自動適用しません。
相手DON!!の移動、付与そのものを条件とする新誘発、同一付与workでACTIVE/RESTを混在させる指定、イベントMAIN対応範囲の拡張、PR10以降は未対応です。

## 検証・変更一覧

- 関連23件、全回帰863件成功。失敗・スキップ0。
- 両席、アクティブ/レスト付与、複数付与先、付与先離脱、各領域からの返却、コスト/効果区別、原子的拒否、古い参照・再送・非公開投影、親workとの順序を確認。
- 共有移動処理のため隔離v3以外も含む全サーバーテストを実行。フロント・サーバービルド、Schema28/29生成再現性確認に成功。依存追加なし。
- [ローカル確認用サーバー](http://127.0.0.1:5191/)。実カードの新規ルームモードは追加せず、機能は合成fixtureで検証。
- 集計: 23ファイル（既存16、新規7）。全体+7135/-114行。生成物4ファイル（Schema2・型コピー・命令一覧）除外+547/-51行。

変更ファイル:

- `docs/card-effect-don-transfer.schema.json`（生成）
- `docs/card-effect-implementation-roadmap.md`
- `docs/card-effect-pr09b.md`
- `docs/card-effect-supported-operations.json`（生成）
- `docs/card-effect-types.ts.txt`（生成）
- `docs/validate-card-effect-json.cjs`
- `schemas/effect-v3-subset29.schema.json`（生成）
- `server/src/test/effects/v3/compiler.ts`
- `server/src/test/effects/v3/conditionalTriggers.ts`
- `server/src/test/effects/v3/dsl.ts`
- `server/src/test/effects/v3/fixtureCoordinator.ts`
- `server/src/test/effects/v3/fixtureProtocol.ts`
- `server/src/test/effects/v3/matchCoordinator.ts`
- `server/src/test/effects/v3/resolution.ts`
- `server/src/test/movement/engine.ts`
- `server/src/test/movement/types.ts`
- `server/src/test/movement/validation.ts`
- `server/test/v3-don-transfer.cjs`
- `src/testMatch/V3FixtureLobby.tsx`
- `src/testMatch/V3SessionPanel.tsx`
- `tools/build-v3-don-transfer-inventory.cjs`
- `tools/build-v3-don-transfer-schema.js`
- `tools/test-v3-don-transfer-schema.test.js`
