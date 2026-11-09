# PR09a DON!!の状態変更・追加

基準コミット: `bde8a25`。ロードマップ09aのみ。既存のRuntime、選択待機、FixtureCoordinator、MovementStore、EventContext、誘発キューを再利用します。

## 対応するDSL

- Schema `3.0.0-subset.28` / Compiler `v3-subset-compiler.28.1`。
- Registryは57登録。新規は `action:SET_DON_STATE@1` と `action:ADD_DON@1`。
- Registry hash: `fb4c7be31cdabe9a92906d99fa9e57834f543a772093d1917b6eed204418e6ea`。
- Schema28のLFファイルSHA256: `cc061b5cd7d5ffb3088e2c52fbe0afaddd6030706c8f3af4c4bfc9de0dad4e5d`。
- 旧16〜27のSchema、Compiler版、Registry hashおよび既存14枚の定義・承認manifestを維持。新規実カードの承認なし。

```json
[
  {
    "type": "SELECT",
    "bindAs": "don",
    "selector": {
      "type": "CARDS",
      "owner": "SELF", "controller": "SELF", "chooser": "SELF",
      "zone": ["restDon"], "cardTypes": ["don"],
      "visibility": "PUBLIC", "faceUpOnly": true, "excludeSource": false,
      "min": 0, "max": 2, "selectionMode": "SELECT", "order": "UNORDERED", "onInsufficient": "fail",
      "filters": { "type": "all", "conditions": [] }
    }
  },
  { "type": "SET_DON_STATE", "cards": { "ref": "bindings.don" }, "from": "REST", "to": "ACTIVE" },
  { "type": "ADD_DON", "player": "SELF", "count": 1, "state": "REST", "onInsufficient": "fail" }
]
```

これは合成例で、カード全文の変換ではありません。

- SET_DON_STATEは既存CARDSで得たbindingを使用。ACTIVE/REST間だけを許し、同じ状態の指定・10枚を超えるbindingはCompilerで拒否。選択0枚は何もせず続行します。
- ADD_DONは自分のDON!!デッキ上から1〜10枚を指定の状態へ表向きで移動。枚数不足時はwork全体を拒否し、部分追加・新規個体生成はしません。
- 付与DON!!はactiveDon/restDonと別領域。状態変更には使えず、付与先の参照は既存盤面検証で引き続き管理します。付与先や付与状態をこの命令から変更できません。

## Runtimeと安全性

1. 既存選択の本人・token・revision・候補を照合してworkを発行。
2. CoordinatorでworldRevision、正確な個体・世代、kind、所有者、操作者、領域、表裏と状態を再検証。対象の重複、付与中、現在状態の不一致、不正枚数は拒否。
3. 状態変更は既存setRest、追加は既存moveを使い、対象全部の確認後に単一transactionとして確定。途中で失敗したworkは状態もイベントも部分確定しません。
4. 既存の署名付きframe、request receipt、revisionを維持。旧refを新世代へ自動で付け替えません。

状態変更は `restChanged`（世代維持）、デッキからの追加は `moved`（世代更新）。どちらも効果由来の `EFFECT_MOVE` として、効果操作者・発動元・解決ID、前後の領域/参照を既存MovementEventとEventContextの契約で保持します。
コストの `PAY_COSTS` / `COST_PAYMENT` やフェイズ処理の `RULE_PROCESSING` には転用せず、前段で確定した別workを巻き戻しません。
既存イベント処理に通しますが、キャラクター登場やKOとして扱わず、DON!!固有の新誘発・購読を追加していません。
Socketへ対象ref・内部イベント証拠を追加せず、既存の盤面投影を使用。隔離v3のwork表示名のみ追加しました。通常対戦・一人回しに変更はありません。

## 裁定・保留

[公式総合ルール ver.1.2.1](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240419=) の6-2〜6-5を参照し、ルール進行によるDON!!移動と今回の効果による操作を区別しています。
[公式EB01 Q&A](https://asia-en.onepiece-cardgame.com/pdf/qa_eb01.pdf) のEB01-012のアクティブ化部分とEB01-021の追加部分を合成fixtureで検証しました。EB01-021でデッキ0枚でも別の手続が可能な裁定を、不足時の強制失敗と同一視しません。今回のADD_DONは厳密枚数の契約であり、任意追加・不足時の部分適用や、両カードの全条件を承認していません。
効果による付与・返却・複数付与先、相手DON!!の効果操作、DON!!固有の誘発、イベントMAINの対応範囲拡張は未実装です。UNKNOWNや未確定裁定は推測で補いません。PR09b以降は未着手です。

## 検証と変更ファイル

- 関連22件、全回帰473件成功。失敗・スキップ0。
- 両席、ACTIVE/REST、最大10枚、既存個体の保存、付与DON!!の除外、不足・混在の原子的拒否、古い参照・再送・不正選択、コストとの分離、TURN_END誘発、誤誘発なしを確認。
- `npm --prefix server run build`、`npm run build`、Schema27/28の生成再現性確認に成功。新規依存なし。
- [ローカル確認用サーバー](http://127.0.0.1:5190/)。新しいカード・ルームモードは追加せず、機能実行は合成fixtureで検証。
- 集計: 20ファイル（既存13、新規7）。全体+6575/-91行。生成物4ファイル除外+426/-31行。

生成物を含む変更ファイルは以下です。

- `docs/card-effect-don-effects.schema.json`（生成）
- `schemas/effect-v3-subset28.schema.json`（生成）
- `docs/card-effect-types.ts.txt`（生成）
- `docs/card-effect-supported-operations.json`（生成）
- `docs/card-effect-implementation-roadmap.md`
- `docs/card-effect-pr09a.md`
- `docs/validate-card-effect-json.cjs`
- `server/src/test/effects/v3/compiler.ts`
- `server/src/test/effects/v3/conditionalTriggers.ts`
- `server/src/test/effects/v3/dsl.ts`
- `server/src/test/effects/v3/fixtureCoordinator.ts`
- `server/src/test/effects/v3/fixtureProtocol.ts`
- `server/src/test/effects/v3/matchCoordinator.ts`
- `server/src/test/effects/v3/resolution.ts`
- `server/test/v3-don-effects.cjs`
- `src/testMatch/V3FixtureLobby.tsx`
- `src/testMatch/V3SessionPanel.tsx`
- `tools/build-v3-don-effects-inventory.cjs`
- `tools/build-v3-don-effects-schema.js`
- `tools/test-v3-don-effects-schema.test.js`
