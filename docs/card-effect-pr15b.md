# PR15b: 公開トラッシュのMAIN本文と共有使用回数

## 対応範囲

- `CALL_EFFECT_BODY` の外部呼び出し形は `{"type":"CALL_EFFECT_BODY","from":"OWN_TRASH","maxPrintedCost":7}`。フィールドのMAIN・登場時・自身の登場を観測する `ON_EVENT` の唯一のルートアクションとして使える。呼び出し元の発動／解決条件、DON!!−1などのコストは従来どおり。EB03-031相当の自己ターン、リーダー名、DON返却、コスト7以下を合成fixtureで検証した。
- 候補は自分が所有・操作する公開トラッシュのイベントで、印刷コストが既知かつ上限以下、対戦に固定された承認済み定義に対応MAINを持つものだけ。0枚なら続行。選ぶのは呼び出し元の操作者で、選択後の本文に別の選択者が指定される場合は既存Runtimeに従う。
- [公式総合ルール 8-5・10-2-3-1-1](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)と[公式EB03カードQ&A（EB03-031）](https://www.onepiece-cardgame.com/rules/qa.php?series=%E3%82%A8%E3%82%AF%E3%82%B9%E3%83%88%E3%83%A9%E3%83%96%E3%83%BC%E3%82%B9%E3%82%BF%E3%83%BC+ONE+PIECE+Heroines+Edition%E3%80%90EB-03%E3%80%91&tab=cardqa&type=1)に沿い、イベント自体のプレイではなく効果を発動する。印刷コストは払わず、参照カードはトラッシュに残り、イベント使用の通知は出さない。本文内の条件・任意支払い・対象選択は通常の命令として解決する。
- subset.41で明示されたイベントMAINの `PER_TURN / SOURCE_OBJECT / count:1` は、ターン・操作者・個体／世代・効果IDをキーに既存台帳を共有する。手札から通常使用した場合はトラッシュに移った個体の世代で記録し、同ターンに同じ個体を呼び出せない。呼び出しは選択受理時に確定し、辞退・候補なし・拒否では消費しない。同番号の別個体や次のターンには持ち越さない。

## 安全性

1. サーバー側で候補と選択tokenを生成し、選ばれた個体・世代・カードID・定義hash・MAIN IDを署名付きフレームに固定する。応答と再開時に権限、期限、revision、トラッシュ所在、hashを検証する。候補とtokenは選択者だけに返す。
2. PR15aと同じ命令展開を使い、承認済み本文を同じ解決IDの続きとして実行する。元のカードと効果IDは呼び出し元として保持し、本文の発生源・原因効果IDは選ばれたイベント・MAINに切り替える。本文で生じたイベントは既存誘発キューに送る。
3. 対象に選べるMAINは本文呼び出しを含められない。呼び出し階層は1段、選択候補256件、命令列とフレームは既存の上限を適用する。再送と古い選択は既存の受付記録で処理し、本文や使用回数を二重に適用しない。

## 互換性・保留

- Schema `3.0.0-subset.41`、Compiler `v3-subset-compiler.41.1`、Registry SHA-256 `6663091571271b560ff02ee7e63376c48a05d3cd3a20fbbbc1746f767c92fa7d`。生成Schema SHA-256（LF）: `d0461efb590cf27b068a19e7057a9d5fd95a67437e95217516f3868da9c5fdc2`。
- 旧ハッシュ、既存14枚の承認manifest、通常対戦・一人回しは変更なし。実カードの新規承認なし。
- 呼び出し先の独立した発動条件・解決条件、必須追加発動コスト、複数回制限、異なるカードや効果IDをまたぐ共有枠、非公開領域・相手のトラッシュ、複数／連鎖呼び出しは未対応。未承認・未対応の本文は候補に出さない。PR16以降には進んでいない。

## 検証と変更ファイル

- 関連11件成功。全回帰は一括931件成功（失敗・スキップ0、個別再実行なし）。フロント・サーバービルド成功。
- 集計: 22ファイル（新規8、既存14）、全体+9648/-154行、生成物を除き+525/-80行、実行ソース+227/-79行。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`effectBodyCalls.ts`、`simpleMainEvent.ts`、`replacementPlans.ts` |
| Coordinator・誘発・通信 | `server/src/test/effects/v3/fixtureCoordinator.ts`、`matchCoordinator.ts`、`conditionalTriggers.ts`、`fixtureProtocol.ts` |
| 隔離対戦UI | `src/testMatch/V3ChoicePanel.tsx` |
| テスト | `server/test/v3-external-body.cjs`、`tools/test-v3-external-body-schema.test.js` |
| 生成・検証 | `tools/build-v3-external-body-schema.js`、`tools/build-v3-external-body-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset41.schema.json`、`docs/card-effect-external-body.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr15b.md` |
