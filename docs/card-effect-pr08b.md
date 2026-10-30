# PR08b 今回依頼の移動記憶拡張

基準コミット: `6f5baf3`。

## 範囲の相違

ロードマップ08bは「手札からの効果登場」です。一方、今回の依頼本文は「移動記憶の汎用化」を指定しています。
今回の明示範囲を優先し、PR08aの公開された色の記憶について、snapshot・印刷/現在値・対象行の選別を実装しました。
ロードマップ本来の効果登場を完了したとは扱いません。PLAY_BY_EFFECT、空き枠選択、効果登場のON_PLAYは未実装のままです。
PR08c以降、通常対戦、一人回し、通常ルーム、カード番号専用処理は変更していません。

## 版・互換性

- Schema: `3.0.0-subset.26`。Compiler: `v3-subset-compiler.26.1`。
- Registry: 54登録。新規は `action:REMEMBER_FACTS@1`、`predicate:REMEMBERED_COLORS@1` の2つのみ。
- Registry hash: `711fa5cfeda8c91b84dc1ac7f955a52f5a0b9da4ddb46cb18d1f794595b9bc2d`。
- Schema26のLFファイルSHA256: `8e9e0b69a4e183c5b3ac3b8f66194884e7703616d872fcb9f557e59ff909cdca`。
- 旧16〜25のSchema・Compiler版・Registry hashを維持。旧25 hash: `e9765f1965231d4ec630b66d76a74b15f77ecd945c40e460df02f012714cd1a8`。
- 既存14枚の定義・原資料・承認manifestは変更なし。合成fixtureだけで検証し、実カードの新規承認はしていません。
- PR08aのMOVE_RESULT/MOVED_COLORSは従来の意味・引数を維持。新profileのみ印刷色snapshotを追加。

## DSL

既存MOVE_CARD成功直後にMOVE_RESULTで `returned` を保持した後の例です。

```json
{
  "type": "REMEMBER_FACTS",
  "result": "returned",
  "cards": { "ref": "bindings.chosen" },
  "snapshot": "BEFORE",
  "basis": "CURRENT",
  "field": "colors",
  "bindAs": "returnedColors"
}
```

- すべての引数が必須。共通meta `id` / `sourceSpan` のみ任意。
- result: 同じ解決スコープで宣言済みのMOVE_RESULT名。
- cards: `null`なら結果の全行。bindingを指定する場合は、そのbindingにある**移動前の正確な個体ID/世代**に一致する行だけを記憶。
- snapshot: BEFOREまたはAFTER。実行時点の盤面を読み直す指定ではありません。
- basis: PRINTEDまたはCURRENT。指定snapshot時点の印刷色/現在色を選びます。
- field: 現段階はcolorsだけ。名前・特徴・数値・任意property pathは未公開で、指定すると拒否。
- bindAs: カードbinding・移動結果名とは別の型付き記憶名前空間。未宣言参照・重複・分岐外参照をCompilerが拒否。

```json
{
  "type": "REMEMBERED_COLORS",
  "memory": "returnedColors",
  "subject": "CANDIDATE",
  "basis": "CURRENT",
  "match": "DISJOINT"
}
```

- 引数はすべて必須。subjectはSOURCE/CANDIDATE、basisはPRINTED/CURRENT、matchはOVERLAP/DISJOINT。
- このbasisは**比較先カードの現在盤面で認可された値の基準**。記憶を作ったsnapshot/basisと独立です。
- 選別された行の色の集合和と比較。OVERLAPは共通色が1つ以上、DISJOINTは0。
- 選別後0行、1行でもUNKNOWN、権限外、比較先不明ならUNKNOWN。false・0・空の既知値へ補完しません。
- SelectorとQueryのfilter、IF、AND/OR/NOTが共通評価器を使用。条件が成立した後は既存DRAW等の解決を続行でき、新しい専用解決器はありません。
- 値の全角・半角、大文字・小文字はそのまま。これらの機械的集合演算を特定のカードの公式裁定と見なしません。

## 状態・参照・公開権限

1. PR08aの既存MovementOccurrenceとMovementEvent、MOVE_RESULT、署名付きframeを再利用。
2. 新profileの移動workでは、before/afterの公開権限をそれぞれ確認したDerivedCardFactsから、CURRENTとPRINTEDの色を保存。
3. 元のMoveResult行はeventId/groupId/operationIndex/transactionId、前後の個体/世代・領域・原因を保持。別の移動エンジンやイベントバスは追加しません。
4. REMEMBER_FACTSは元の移動結果の行から選別し、identity、workId、transactionId、snapshot、basis、field、行のeventId、EventContextのmovement部分、EventCause、許可済み値を保存。
5. effect操作者、選択者、カード所有者を新しい曖昧なplayerへ統合しません。保存identityと既存EventCauseを維持。
6. 行はカード番号や名前、表示順/indexで選びません。重複個体、結果にない個体、移動後世代を移動前参照の代わりに渡す指定、不正なref構造を拒否。
7. cardsで指定された全個体が一致しなければ処理を拒否し、黙って一部だけ採用しません。選別順序は元のサーバー結果順です。
8. 記憶値は作成後不変。元カードの再移動や、別リクエストによる公開で値を再計算しません。

公開済みキャラから手札への移動ではBEFOREは記憶できますが、非公開のAFTERはUNKNOWNです。
手札からトラッシュへ移動した場合、AFTERは公開値を使えてもBEFOREは未知のまま。どちらも逆側snapshotへフォールバックしません。
移動後にREVEALしても、移動当時AFTERが非公開だったsnapshotを後から既知にしません。
旧profileの結果にPRINTED snapshotがなければUNKNOWN。CURRENTの値を印刷値として使いません。
旧い「移動前ref」は履歴の行を指定するキーであり、現在盤面に存在するカードとして使えるrefではありません。
PR08aのcurrentMovedRefの厳密な世代・領域・閲覧権限・live capability検査を緩めたり、新世代へrefを付け替えたりしていません。

## 中断・再開・失敗

- 共通 `v3-frame.9` に新profile用の任意 `factScopes` を追加。署名・定義hash・compiler/registry版・revision照合を維持。
- 同じ解決内のmatch/resolution/effect/actor/source個体・世代が一致する記憶だけを参照。別の効果・試合へ持ち越さない。
- 記憶スコープは既存分岐のENTER/EXITに追随し、分岐終了時に破棄。異なる記憶名は独立。
- 選択待機後も元の記憶で再開。選択者・token・世代・領域の既存再検証を維持。
- request receipt、古revisionの拒否、HMACを維持。再送による記憶や移動の重複なし。
- 記憶の検査失敗/UNKNOWNは既存の安全停止・ロックを維持し、成功していないframe変更を確定しません。既に別workで確定した移動を取り消す仕様ではありません。
- 既存frameの262144-byte上限内。DB永続化、サーバー再起動復旧、安全停止からの管理者復旧は追加していません。
- 記憶値・参照・原因・snapshot・行名をSocket DTOへ追加せず、クライアントからそれらを受信するAPIも追加していません。

## 検証

- 新規24件成功: Runtime/Coordinator22、Schema/Registry2。
- 全回帰425件成功。失敗0、スキップ0。既存14枚、PR05a/b、選択再開、期限、移動記憶、秘匿・再送を含む。
- 両seatの成功、BEFORE/AFTER、PRINTED/CURRENT、複数移動と部分行、後からの公開、UNKNOWNの伝播、Query/Selector、署名改ざん、古い参照、別identity、分岐、再送を検証。
- `npm --prefix server run build`、`npm run build`成功。フロントの既存chunkサイズ警告のみ。
- Schema25/26の生成再現チェック成功。Ajv8は既存の一時ディレクトリをNODE_PATHで利用。依存・lockfile変更なし。
- 記録: `local-data/pr08b-tests.log`、`local-data/pr08b-related.log`、`local-data/pr08b-frontend-build.log`（git管理外）。
- 実機UI/新カードの公式裁定確認を行ったとはしていません。新しいUIやfixtureモードは追加せず、既存Coordinatorを合成fixtureから実行しました。

```powershell
$env:NODE_PATH = Join-Path $env:TEMP 'tcg-card-effect-validator/node_modules'
npm --prefix server run build
node --test server/test/v3-remembered-facts.cjs tools/test-v3-remembered-facts-schema.test.js
node tools/build-v3-remembered-facts-schema.js --check
npm run build
```

## 未対応

- ロードマップ本来のPR08b「手札からの効果登場」。PR08c以降は未着手。
- 色以外の記憶対象、任意property path、数値式への記憶値の埋込み、記憶したrefを新しい操作権限として使う機能。
- 非公開の事実の記憶、他効果への記憶引渡し、任意イベントからのLKI、KO等の別workの記憶。
- EB01-020のカード全体の承認、多色文言などの未確定裁定、EB01-013の追加cost、複雑な部分成功・置換。
- PR12の動的な色変更処理は追加しない。現在色の読取契約がUNKNOWNなら安全停止するだけです。

## 変更規模・一覧

大規模な既存処理の置き換え、独立Runtime、重複した移動処理なし。新schema/profileの継承箇所と共通の記憶読み取りを必要範囲で拡張しました。
集計: 20ファイル（既存12、新規8）、全体+6400/-102行。生成物4ファイル（Schema2、型コピー、命令一覧）除外+531/-46行。Schemaのみ除外+848/-102行。実行ソース（server/src）+113/-45行。

- `docs/card-effect-implementation-roadmap.md`
- `docs/card-effect-pr08b.md`
- `docs/card-effect-remembered-facts.schema.json`（生成）
- `docs/card-effect-supported-operations.json`（生成）
- `docs/card-effect-types.ts.txt`（生成）
- `docs/validate-card-effect-json.cjs`
- `schemas/effect-v3-subset26.schema.json`（生成）
- `server/src/test/effects/v3/compiler.ts`
- `server/src/test/effects/v3/conditionalTriggers.ts`
- `server/src/test/effects/v3/dsl.ts`
- `server/src/test/effects/v3/fixtureCoordinator.ts`
- `server/src/test/effects/v3/fixtureEnvironment.ts`
- `server/src/test/effects/v3/matchCoordinator.ts`
- `server/src/test/effects/v3/moveResults.ts`
- `server/src/test/effects/v3/resolution.ts`
- `server/test/helpers/v3-memory.cjs`
- `server/test/v3-remembered-facts.cjs`
- `tools/build-v3-remembered-facts-inventory.cjs`
- `tools/build-v3-remembered-facts-schema.js`
- `tools/test-v3-remembered-facts-schema.test.js`
