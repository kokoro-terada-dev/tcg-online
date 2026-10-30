# PR08a 型付き移動結果と公開情報の記憶

基準コミット: `37e17ae`。PR08aのみ。PR08b以降、効果登場、PR12の継続効果は実装していません。

## 版と互換性

- Schema: `3.0.0-subset.25`。
- Compiler: `v3-subset-compiler.25.1`。
- Registry: 52登録。新規は `action:MOVE_RESULT@1` と `predicate:MOVED_COLORS@1` のみ。
- 新Registry hash: `e9765f1965231d4ec630b66d76a74b15f77ecd945c40e460df02f012714cd1a8`。
- SchemaファイルSHA256: `9c2a0ebe447dab35dee5d87413c6e263ef42a0d08bcc4a95861be74d8775a517`。
- 旧16〜24のSchema、Compiler version、Registry hashは維持。旧24 hashは `3780ed0fdeb5c26d43c2f7093e3d767933bfe305094290646fd5943d5cc54af1`。
- 既存14枚の定義・出典・承認manifestは変更なし。新規実カードの承認なし。
- 共通frameは既存 `v3-frame.9`。新profileのみ任意フィールドresultScopes/lastMoveResultを使用し、旧保存フレームの必須項目を増やしていません。署名・定義hash・profileの照合は維持。

## DSL

既存のSELECTで `chosen` を選んだ後の例です。新たな移動命令は作らず、既存MOVE_CARDと共通workを使います。

```json
[
  {
    "type": "MOVE_CARD",
    "cards": { "ref": "bindings.chosen" },
    "destination": { "owner": "SELF", "zone": "hand", "position": "append", "faceUp": true },
    "cause": "EFFECT"
  },
  { "type": "MOVE_RESULT", "bindAs": "returned" },
  {
    "type": "SELECT",
    "bindAs": "differentColor",
    "selector": {
      "type": "CARDS", "owner": "SELF", "controller": "SELF", "chooser": "SELF",
      "zone": "hand", "visibility": "OWNER_ONLY", "faceUpOnly": false,
      "cardTypes": ["character"], "excludeSource": false,
      "filters": { "type": "MOVED_COLORS", "result": "returned", "subject": "CANDIDATE", "basis": "CURRENT", "match": "DISJOINT" },
      "min": 0, "max": 1, "selectionMode": "SELECT", "order": "UNORDERED", "onInsufficient": "fail"
    }
  }
]
```

これは部分的な合成DSL例であり、特定カードの全文マッピングや公式裁定の承認ではありません。

### MOVE_RESULT

- 必須: `bindAs`。共通の任意meta `id` / `sourceSpan` も利用可能。
- 同一action配列の直前がMOVE_CARDの場合だけCompilerが受理。別の移動や任意のeventIdを指定できません。
- 移動処理そのものは行わず、直前の成功workの結果を記憶します。移動成功の証拠がなければ受理しません。
- 名前はカードbindingとは別の型付き名前空間。前方参照、同じスコープの重複、分岐外への漏出をCompilerで拒否。
- 選択0枚なら空結果を保持できますが、色を捏造しません。

### MOVED_COLORS

- 必須: `result`（宣言済み結果名）、`subject`（SOURCE/CANDIDATE）、`basis`（PRINTED/CURRENT）、`match`（OVERLAP/DISJOINT）。
- 比較元は**移動前に双方へ公開されていたCURRENTの色**のみ。basisは比較先カードの印刷値/現在値を指定します。
- 複数移動では保存された全行の色の集合和を使用。OVERLAPは共通色が1つ以上、DISJOINTは共通色が0。
- どれか1行でも移動前の色がUNKNOWNなら、集合全体もUNKNOWN。空の移動結果もUNKNOWNです。
- 名前・色の全角/半角、大文字/小文字を正規化しません。多色の集合演算はこの命令の明示仕様であり、未確認のカード原文解釈ではありません。
- Selector、Query、IFとAND/OR/NOTの既存評価器を共用。非公開の比較先も既存DerivedCardFactsの権限を通過する必要があります。
- UNKNOWNは既存の安全停止となり、falseや空配列に置き換えません。自動復旧UIはありません。

## 移動証拠と状態遷移

1. 新profileのFixtureCoordinatorが既存MovementOccurrenceの記録をopt-in。
2. 既存MovementStoreがMOVE_CARDをdraftへ適用し、前後snapshotとMovementEventを発行。
3. captureMoveResultが記録済みeventの同一オブジェクト、前後snapshot、要求された各個体/世代、EFFECT_MOVE、操作者・効果操作者、source、resolutionを照合。
4. 各移動のeventId/groupId/operationIndex、transactionId、領域、before/after個体・世代、原因を保持。
5. 同じトランザクションに複数操作があっても行をまとめたり同名で統合したりしません。付与DON等の自動移動は要求カードの行へ混ぜません。
6. before/afterそれぞれのDerivedCardFacts.current.colorsを、その時点の双方閲覧権限で評価。非公開・不明値はシリアライズ可能な `{status:"UNKNOWN"}`。既知値は `{status:"KNOWN",value:[...]}`。
7. trusted結果だけをsettleWorkへ渡す。workId・revision・effectId・source・操作者・要求個体を再照合して、盤面とframeを既存draftで一括確定。
8. MOVE_RESULTが結果を解決スコープへ保存し、後続条件/選択が参照。選択待機中もHMAC署名付きframeへ含め、再開時に前の色を再計算しません。

EventContextの既存movement部分はmovementReadContextへ抽出し、通常のreadEventContextと移動結果で共用しています。誘発キュー・イベント通知・Runtimeを別系統にしていません。
複数操作を識別できることと、未確定の同時誘発順序を公式ルールとして確定することは別です。既存の保留判定は変更していません。

## 参照寿命・秘匿・失敗

- 記憶の所有単位はmatch/resolution/effect/controller/source個体・世代。別の効果や別の試合へ持ち越しません。
- 公開された場の色は、カードが手札へ移動した後も保存値だけを使用。後からその手札を検索しません。
- 手札からトラッシュへ移動して初めて公開されても、非公開だった「移動前の色」を既知扱いしません。移動後の既知値へのフォールバックは禁止。
- 色以外のLKIをDSLへ公開していません。イベントのカードID・参照・原因・保存色・snapshot・記憶名はSocket DTOへ追加していません。
- currentMovedRefはserver-onlyのcertifiedな当該移動結果について、保存された**移動後の正確な世代と領域**を現在盤面で検証し、移動直後と現在の両方で閲覧可能なviewerだけへ返します。
- 古いrefをinstanceId検索で最新世代へ補正しません。再移動、偽造結果、別試合/効果/操作者/source、範囲外行はUNKNOWN。保存frameから取り出した単なるコピーにもこのlive capabilityはありません。
- 公開色の記憶は署名付きframe内の信頼済みデータ。一般クライアントから記憶値や結果オブジェクトを受信するAPIは追加していません。
- world/frame revision、選択者、選択token、HMAC、既存request receiptを維持。再送で再移動・再記憶・再支払いしません。
- 要求した全行の移動証拠が揃わなければ結果を確定しません。証拠検査失敗ではdraftが破棄され、以前の盤面と待機workを維持します。
- 既存MOVE_CARD自体の拒否は従来どおりblocked。既に別リクエストで確定した前段work全体を巻き戻す仕様ではありません。
- メモリはframeの既存262144-byte上限に含まれます。無制限journalや永続DBは追加していません。

## テスト・ビルド

- 新規関連22件: Runtime/Coordinator20、Schema/Registry2。
- 全回帰401件成功、失敗0、スキップ0。既存14枚、PR05a/b、PR06、期限、再送/古revision/選択権限/秘匿を含みます。
- 新規では公開色の固定、多色/文字差、複数移動の識別、空結果、非公開手札、選択待機・再開、Query/Selector共通評価、偽証拠、世代、署名改ざん、不足行、再移動、別effect/controller/sourceを確認。
- `npm --prefix server run build`、`npm run build`成功。フロントは既存の大きいchunk警告のみ。
- Schema23/24/25の生成再現チェック成功。Ajv8は既存の一時ディレクトリをNODE_PATHで使用し、依存・lockfileは変更していません。
- 新profileの実行確認は未承認実カードではなく合成fixture。実機iPhone確認や新カードの公式裁定確認を行ったとはしていません。

実行例:

```powershell
$env:NODE_PATH = Join-Path $env:TEMP 'tcg-card-effect-validator/node_modules'
npm --prefix server run build
node --test server/test/v3-move-results.cjs tools/test-v3-move-result-schema.test.js
node tools/build-v3-move-result-schema.js --check
npm run build
```

## 保留

- PR08b/cの効果登場・空き枠・ON_PLAY連鎖は未実装。新たな登場UIも追加していません。
- EB01-020全文、他能力、自然文から多色比較への意味マッピングは未承認。カード番号専用処理なし。
- KO/DRAW/RETURN_TO_DECKなど別workの結果や任意eventから記憶するDSL、非公開値の記憶、色以外の汎用REMEMBER_FACTSは未公開。
- 同一領域内の並べ替えを世代変更する移動として記憶しません。高度な防止・置換・部分成功からの記憶は、要求行の完全な証拠がなければ保留。
- event MAINの既存プログラム制約は緩めていません。MOVE_RESULTを使ったevent MAINを自動で使用候補にはしません。
- liveな移動後refの再署名・保存復元・選択UIやカードbindingへの自動変換は未実装。既知の公開色だけは同じ解決の署名付きframeから再開できます。
- サーバー再起動をまたぐmatch復旧、公式未確定のLKI/同時処理、PR08b以降は対象外。

## 変更規模・ファイル

既存の移動器や共通解決器の置き換えなし。二重の移動エンジンなし。通常対戦・一人回し・通常ルーム・承認manifestは変更なし。
変更ファイル一覧と差分集計は、同じ作業の `local-data/v3-pr08a-changed-files-20261030.md` に保存します。
詳細な実装ファイルはCompiler/DSL、moveResults、readContext、fixtureEnvironment、FixtureCoordinator、既存profileの継承箇所です。
Schema生成物2ファイルと、型定義コピー・命令一覧・検証ツール・関連テスト・本報告・ロードマップを含みます。

集計: 20ファイル（新規8、既存12）。生成物除外の集計はSchema2ファイル、型定義コピー、命令一覧の計4ファイルを除きます。
変更量: 全体+6200/-96行。生成物4ファイル除外+610/-42行。参考: Schema2ファイルのみ除外+874/-96行。実行ソース（server/src）+185/-41行。

変更ファイル（リポジトリルートからの相対パス）:

- `docs/card-effect-implementation-roadmap.md`
- `docs/card-effect-move-result.schema.json`（生成）
- `docs/card-effect-pr08a.md`
- `docs/card-effect-supported-operations.json`
- `docs/card-effect-types.ts.txt`
- `docs/validate-card-effect-json.cjs`
- `schemas/effect-v3-subset25.schema.json`（生成）
- `server/src/test/effects/v3/compiler.ts`
- `server/src/test/effects/v3/conditionalTriggers.ts`
- `server/src/test/effects/v3/dsl.ts`
- `server/src/test/effects/v3/fixtureCoordinator.ts`
- `server/src/test/effects/v3/fixtureEnvironment.ts`
- `server/src/test/effects/v3/matchCoordinator.ts`
- `server/src/test/effects/v3/moveResults.ts`
- `server/src/test/effects/v3/readContext.ts`
- `server/src/test/effects/v3/resolution.ts`
- `server/test/v3-move-results.cjs`
- `tools/build-v3-move-result-inventory.cjs`
- `tools/build-v3-move-result-schema.js`
- `tools/test-v3-move-result-schema.test.js`
