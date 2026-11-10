# PR27: 場のDON!!枚数比較

## ルールと実装

- [公式総合ルール](https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf) の 3-1-2、3-1-4、3-9、4-4-2、6-5-5 を参照。場のDON!!はコストエリアのアクティブ／レストと、リーダー・キャラへの付与分を含む。DON!!デッキは別領域であり、付与中のDON!!はアクティブでもレストでもない。
- `SELF` は効果の操作者、`OPPONENT` はその相手。どちらも `don.fieldCount`、`don.costAreaCount`、`don.activeCount`、`don.restCount`、`don.attachedCount` を使える。`compare` の `eq`、`ne`、`lt`、`lte`、`gt`、`gte` を再利用し、固定数・相互比較、`all`／`any`／`not` に対応する。
- 評価時の盤面を読むだけで、選択、移動、支払い、公開データの追加は発生しない。異常なDON!!リスト、重複、状態の不一致、古い付与先世代などは `UNKNOWN`。通常の発動条件、発生時点の誘発評価、解決条件、途中の `IF` は既存の評価タイミングを維持する。生成器では原文の「場合」を後続処理の `IF` に置き、コストや他の条件を省かない。
- `QUERY_CARDS` と `COUNT` はカード集合用のまま。DON!!個体やDON!!デッキを参照する新しいクエリは公開しない。継続・置換専用の安定条件には、この段階では新しい値を許可しない。

```json
{
  "type": "compare",
  "left": { "ref": "SELF.don.fieldCount" },
  "op": "lte",
  "right": { "ref": "OPPONENT.don.fieldCount" }
}
```

Schema `3.0.0-subset.47`、Compiler `v3-subset-compiler.47.1`、Registry `compare@4`。Registry SHA-256: `a24283463bce8af9ef8d27e2ce396e93aa93631dbeb5d5c4a0513e877da52713`。旧Registryと既存14枚の承認記録は未変更。新規承認は0枚。

## 対象93番号の集計

PR26でタグ付けした111箇所を、同じカード番号・版・原文範囲で追跡した。固定数43番号・55箇所、プレイヤー間比較26番号・28箇所、複合／未確定24番号・28箇所。分類は原文に対する構文分析であり、カード全体の意味の保証ではない。

| 新規に生成できたパターン | 番号 | 箇所 | うち完全生成 |
| --- | ---: | ---: | ---: |
| 固定数との比較（自分が指定枚数以上6番号、以下3番号） | 9 | 14 | 2 |
| プレイヤー間比較（自分が相手以下8番号、相手が自分より多い2番号） | 10 | 12 | 4 |
| 計 | 19 | 26 | 6 |

代表照合: `OP01-095` は自分の場が8枚以上なら1枚引く。`OP09-066` は相手が自分より多い場合に、相手のコスト3以下のキャラを最大1枚KOする。`OP12-078` は自分が相手以下なら1枚引き、その後に相手キャラのパワーを変更する。`P-093` は自分が相手以下なら、既存の選択機構で0〜1枚をレスト追加する。`OP06-069` は相互比較と手札条件を両方保持する。これらは承認ではない。

| 指標（全2,885番号） | PR25 | PR27 |
| --- | ---: | ---: |
| 完全生成 | 464 | 470 |
| うち効果なし | 291 | 291 |
| 部分生成 | 514 | 516 |
| 生成不能 | 1,744 | 1,735 |
| 未判定 | 163 | 164 |
| Compiler成功 | 464 | 470 |
| 未解釈箇所 | 3,341 | 3,315 |
| 対応候補 | 451 | 457 |
| 承認済み | 14 | 14 |

PR25の完全生成464件は、カード番号単位で状態・定義ハッシュが全件一致。`OP07-066` は原文の解釈が完了した結果、印刷パワーの欠損が単独で残ったため、部分生成から未判定へ移った。PR26の分析上は残り74番号・85箇所を `field-don-context-unconfirmed` とし、枚数参照自体が未実装とは数えない。枚数差の算術、継続・置換条件、条件付き自己登場、未確認の複合条件や後続操作は保留。

## 再実行と検証

```powershell
npm --prefix server run build
node tools/build-v3-field-don-profile.cjs --check
$source = 'local-data/v3-review-ledger-pr00-20261029/source.csv'
$ledger = 'local-data/v3-review-ledger-pr00-20261029/review-ledger.json'
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed $source local-data/v3-drafts-pr27-report --ledger $ledger
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-pr25-report local-data/v3-drafts-pr27-report local-data/v3-drafts-pr27-vs-pr25
node tools/analyze-v3-draft-details.js $source local-data/v3-drafts-pr25-report/generation.json local-data/v3-drafts-pr27-report/generation.json local-data/v3-pr27-report
```

出力先は未作成のディレクトリを指定する。詳細レポートの `fieldDonCohort` に版ハッシュ・表示ID・原文・位置・条件の構造・生成状況を保存する。CSVと承認カタログ、ローカルの生成物はコミットに含めない。

フロント・サーバービルドおよびSchema／Registry生成物照合は成功。全回帰一括は999件中998件成功。残る1件はWindowsサンドボックス内の既存シャード試験でファイル移動が `EPERM` になったもの。コードやテストを変更せず権限制限のない環境でシャード試験を再実行し、5件すべて成功。スキップなし。

## 変更ファイル

- 基盤: `server/src/test/effects/v3/compiler.ts`, `conditionalTriggers.ts`, `dsl.ts`, `fixtureCoordinator.ts`, `fixtureEnvironment.ts`, `matchCoordinator.ts`, `replacementPlans.ts`, `resolution.ts`。
- 生成・分析: `tools/build-v3-field-don-profile.cjs`, `tools/generate-v3-drafts.js`, `tools/v3-draft-structure.js`, `tools/v3-draft-diagnostics.js`, `tools/analyze-v3-coverage.js`, `tools/analyze-v3-draft-gaps.js`, `tools/analyze-v3-draft-blockers.js`, `tools/analyze-v3-draft-details.js`。
- テスト: `server/test/v3-don-effects.cjs`, `tools/test-v3-field-don-schema.test.js`, `tools/test-v3-drafts.test.js`, `tools/test-v3-draft-blockers.test.js`, `tools/test-v3-draft-details.test.js`。
- 資料・生成物: `docs/card-effect-pr27.md`, `docs/card-effect-supported-operations.json`, `schemas/effect-v3-subset47.schema.json`。
