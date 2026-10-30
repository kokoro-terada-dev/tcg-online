# PR08 手札からの効果登場

基準コミット: `e1ebf0c`。今回依頼の報告ファイル名はPR08cですが、実装範囲はロードマップ08bの残課題「手札からの効果登場」です。
元の08cにあるデッキ/トリガーからの登場やPR09以降は実装していません。

## 版・承認

- Schema `3.0.0-subset.27` / Compiler `v3-subset-compiler.27.1`。
- Registry 55登録。新命令は `action:PLAY_BY_EFFECT@1` のみ。
- Registry hash: `3f1fbed919c54d1ea8916d54e7e7a64a5b9d42f829109ae29d835146d4916e2f`。
- Schema27 LFファイルSHA256: `e270c22bfd79cbdc2ecd9c5c56ca752950fbfbef9c4021ae73e1880a0bc8c472`。
- 旧16〜26のSchema・Compiler版・Registry hashと既存14枚の定義・原資料・承認manifestを維持。
- 旧26 Registry hash: `711fa5cfeda8c91b84dc1ac7f955a52f5a0b9da4ddb46cb18d1f794595b9bc2d`。
- 未対応能力を省略して実カードを承認していません。テストの承認は合成fixture限定です。

## DSL

```json
[
  {
    "type": "SELECT",
    "bindAs": "chosen",
    "selector": {
      "type": "CARDS", "owner": "SELF", "controller": "SELF", "chooser": "SELF",
      "zone": "hand", "visibility": "OWNER_ONLY", "faceUpOnly": false,
      "cardTypes": ["character"], "excludeSource": false,
      "filters": { "type": "compare", "left": { "ref": "CANDIDATE.current.cost" }, "op": "lte", "right": 3 },
      "min": 0, "max": 1, "selectionMode": "SELECT", "order": "UNORDERED", "onInsufficient": "fail"
    }
  },
  {
    "type": "PLAY_BY_EFFECT",
    "cards": { "ref": "bindings.chosen" },
    "from": "hand",
    "destination": { "owner": "SELF", "zone": "character", "slotPolicy": "FIRST_EMPTY" },
    "enterState": "ACTIVE",
    "provenance": "EFFECT",
    "condition": { "type": "compare", "left": { "ref": "CANDIDATE.current.cost" }, "op": "lte", "right": 3 }
  },
  { "type": "MOVE_RESULT", "bindAs": "played" }
]
```

これは合成部分例であり、特定カードの全文変換や公式裁定の承認ではありません。
PLAY_BY_EFFECTの全引数が必須。共通meta id/sourceSpanのみ任意です。

| 引数 | 現在の対応 |
| --- | --- |
| cards | 宣言済みカードbinding。Compilerの最大枚数は5以下。0枚選択は何もせず後続へ |
| from | handのみ |
| destination | owner SELF / zone character / slotPolicy FIRST_EMPTYのみ |
| enterState | ACTIVEまたはREST。いずれも表向き |
| provenance | EFFECT固定。通常登場の偽装指定は拒否 |
| condition | 既存Predicate。CANDIDATE等を共通評価器で登場work作成直前に検査 |

選択filterと登場conditionは別々の明示的な条件です。filterは選択時、conditionは登場を解決する段階の値を確認します。
元のカード原文でどちらの時点を要求するかは定義レビューで決め、過去の発動条件/解決条件のタイミングを一括変更しません。
conditionがfalseならblockedで未移動。UNKNOWNは既存エラー・安全停止を維持し、falseや0へ変換しません。

## 共通処理への接続

1. SELECTの既存サーバー候補生成、token、選択者、世代/領域/権限/filter再検証を利用。
2. 共通Runtimeが条件確認後にPLAY_BY_EFFECTのworkを発行。効果専用Runtimeや移動器は作らない。
3. FixtureCoordinatorがworkのfrom/provenance/destination/enterState/枚数/重複、正確な個体・世代・手札領域を検証。
4. 手札の所有者・操作者・領域playerが効果操作者と一致し、kindと承認済み定義がcharacterであることを再確認。
5. 空き枠が全対象分ある場合だけ、既存MovementStoreの単一transactionで左から順にfirstEmptyへ移動。
6. 移動で新世代・enteredTurn・表向き・ACTIVE/RESTを確定。causeは既存EFFECT_MOVE、effectController/source/resolutionを保持。
7. 既存のMOVE_RESULT証拠を保存し、盤面・frame・イベント・修正台帳のpruneを既存draftで一括確定。
8. 既存のself ON_PLAYと条件付きON_EVENT監視へ同じイベントを一度だけ渡す。親効果の解決を完了してから、既存の順序選択・選択待機・再開で誘発を解決。

複数枚はサーバーで確定した選択順に配置します。空き枠不足では全workを拒否し、一部だけ移動したり場のカードを勝手にトラッシュしたりしません。
これは今回対応する限定的な空き枠policyであり、満杯時のすべての公式処理を実装したという意味ではありません。
複数移動の条件付き監視で既存PR06が裁定未確定としてHELDにするケースは、今回も実行せず保留します。

## 通常登場・コスト・公式根拠

通常のplayCardとその印刷DON支払い処理は変更していません。
PLAY_BY_EFFECTはそこへ転送せず、既存の効果workから移動させます。登場対象の印刷costでDONを自動レストしません。
DON不足でも余っていてもこの動作は同じで、原文で指示された既存の発動costがあれば従来のPAY_COSTSとして別に処理します。
イベントMAINから呼ぶ場合も、イベント使用時の印刷costだけは既存PR05の手続で支払い、登場させるキャラクターの印刷costを重ねて払いません。
印刷costの不明値を0扱いにはしていません。costを条件として読む場合にUNKNOWNなら停止し、そもそも参照しない動作では勝手に追加条件にしません。

[公式総合ルール ver.1.2.1（2026-08-28）](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240419=) の6-5-3/4でカードのプレイと効果の発動を区別し、8-4-4で選択時点、8-6-3で派生効果の解決順を確認しました。
今回の限定DSLの範囲を超える置換・満杯時処理・複雑な同時登場の個別裁定は確定していません。

## 世代・記憶・中断・秘匿

- workのworldRevisionと現在盤面が一致することを要求。条件確認と移動適用の間に別の盤面workやMAIN操作を割り込ませません。
- 既存のHMAC署名付きframe、frame/movement/progression revision、request receiptを維持。再送で再移動・再支払い・重複誘発を起こさない。
- 移動前の選択bindingを新世代へ自動補正しません。登場後に古いrefを通常カードとして使う処理は拒否。
- ON_PLAYの発動元には移動イベントの新しいrefを使用。手札の同名別個体は別sourceとして扱います。
- MOVE_RESULTはPLAY_BY_EFFECT直後にも使用可能。記憶の BEFORE は元の非公開手札なのでUNKNOWN、AFTERの公開色はREMEMBER_FACTSから参照可能。
- 新refを任意のlive bindingへ変換する機能は追加しません。後続の盤面選択やON_PLAY自身のSOURCEは既存の正しいrefを使います。
- 選択中の手札候補・token・記憶・内部移動証拠を相手へ送信しません。成功後の登場カードだけが通常の公開盤面へ反映され、残り手札のID/refは伏せたまま。
- 任意選択0枚・候補0枚かつmin0は既存の空binding処理で完了。min1で不足した場合は既存のinsufficient-candidatesエラーで未変更のready frameとロックを維持。
- 移動workの拒否はblocked。既に別workで確定した発動costやイベント使用を巻き戻す仕様ではありません。
- サーバー再起動をまたぐmatch永続化や、HELD/blockedからの管理者復旧は未追加。

## UI・検証

既存の手札選択UIと共通work適用ボタンを再利用し、隔離v3のworkTypeと「効果で登場」ラベルだけを追加。通常対戦・一人回しのUI変更なし。
新しい実カードの承認、合成ルームモードや既定デッキの変更はありません。新命令を使う定義の実行は合成fixtureで検証しました。
ローカル最新版の確認用サーバーは `http://127.0.0.1:5197/`。既存の他ポートのサーバーは停止していません。

- 関連26件成功: Runtime/Coordinator24、Schema/Registry2。
- 全回帰451件成功、失敗0、スキップ0。既存14枚、旧profile、PR05・誘発・期限・記憶・秘匿・再送を含む。
- 両seatとACTIVE/REST、DON不足/十分、条件不一致/UNKNOWN/候補0、満杯/一部空き不足、複数個体、旧ref、選択再開、偽token・不正選択者、ワーク再送、登場時誘発の順序、連鎖、他カード登場監視、イベントMAINを検証。
- `npm --prefix server run build`、`npm run build`成功。既存のフロントchunkサイズ警告のみ。
- Schema26/27の生成再現チェック成功。Ajv8は既存の一時ディレクトリを使用し、依存/lockfileは変更していません。
- git管理外の記録: `local-data/pr08c-tests.log`、`pr08c-related.log`、`pr08c-frontend-build.log`。
- 新規の実機iPhone操作確認、全実カードの意味レビュー、未確定裁定の確認を行ったとはしていません。

```powershell
$env:NODE_PATH = Join-Path $env:TEMP 'tcg-card-effect-validator/node_modules'
npm --prefix server run build
node --test server/test/v3-effect-play.cjs tools/test-v3-effect-play-schema.test.js
node tools/build-v3-effect-play-schema.js --check
npm run build
```

## 未対応

デッキ/閲覧済みデッキ/ライフ/トリガー保管からの登場、ステージの効果登場、相手の手札からの登場、手動slot選択、満杯時の置換、複雑な部分成功、未確定の同時誘発。
EB01-013の自己破棄等の未対応costや、EB01-009/P-160の未対応能力・入力異常は引き続き保留。カード全体の自動承認なし。
PR09以降には進んでいません。

## 変更規模・ファイル

共通移動器・Runtime・選択待機・誘発キューを再利用し、独立解決器やカード番号分岐は追加していません。通常登場処理の大規模な書き換えなし。
集計: 22ファイル（既存14、新規8）。全体+6447/-91行。生成物4ファイル（Schema2・型コピー・命令一覧）除外+492/-33行。Schemaのみ除外+777/-91行。実行ソース（server/srcとsrc）+57/-31行。

- `docs/card-effect-implementation-roadmap.md`
- `docs/card-effect-pr08c.md`
- `docs/card-effect-effect-play.schema.json`（生成）
- `docs/card-effect-supported-operations.json`（生成）
- `docs/card-effect-types.ts.txt`（生成）
- `docs/validate-card-effect-json.cjs`
- `schemas/effect-v3-subset27.schema.json`（生成）
- `server/src/test/effects/v3/compiler.ts`
- `server/src/test/effects/v3/conditionalTriggers.ts`
- `server/src/test/effects/v3/dsl.ts`
- `server/src/test/effects/v3/fixtureCoordinator.ts`
- `server/src/test/effects/v3/fixtureProtocol.ts`
- `server/src/test/effects/v3/matchCoordinator.ts`
- `server/src/test/effects/v3/resolution.ts`
- `server/src/test/effects/v3/simpleMainEvent.ts`
- `server/test/helpers/v3-effect-play.cjs`
- `server/test/v3-effect-play.cjs`
- `src/testMatch/V3FixtureLobby.tsx`
- `src/testMatch/V3SessionPanel.tsx`
- `tools/build-v3-effect-play-inventory.cjs`
- `tools/build-v3-effect-play-schema.js`
- `tools/test-v3-effect-play-schema.test.js`
