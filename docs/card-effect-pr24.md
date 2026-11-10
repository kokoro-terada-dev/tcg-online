# PR24: 効果による任意枚数のDON!!追加

## DSLと実行

`3.0.0-subset.46` に `{ "type": "ADD_DON_UP_TO", "player": "SELF", "max": 2, "state": "REST" }` を追加。上限は整数1～10、追加先は発動者自身のコストエリアで、`ACTIVE` と `REST` を区別する。

既存のモードChoiceを使い、解決時に0～min(上限, DON!!デッキ残数)の整数だけを発動者へ提示する。残数0なら盤面を変えずに後続へ進む。応答時に選択者、期限、トークン、revision、残数を再検証する。0枚は移動を発生させず、正の枚数は固定枚数の `ADD_DON` と同じワークに変換して、一括で移動する。選択待機中と応答確定だけではDON!!を動かさない。上限超過・古い選択・権限違反は拒否し、再送で二重適用しない。

不足時は選べる最大値を残数まで下げる。選んだ数を勝手に減らして部分適用する処理はない。固定枚数の `ADD_DON` の不足時拒否、イベント使用コスト、付与、返却、状態切替は既存どおり。移動原因は `EFFECT_MOVE` のままで、既存のイベント通知・誘発キューを経由する。専用誘発イベントは追加しない。[公式Q&A 全般Q5](https://onepiece-cardgame.com/pdf/qa_rule.pdf)、[公式総合ルール §1-3-5-1、§8-4-4-1](https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20251017=)

## 原文分類と変換範囲

PR22の69番号・75箇所を分類した。PR22の照合外だった「ドン‼」も同じ操作として探索すると、PR23時点で141番号・170箇所だった。原文で見つかった指定は下表のとおり。カード番号の列には指定間の重複がある。

| 原文の指定 | PR22: 箇所／番号 | 表記拡張後: 箇所／番号 | PR24で解釈: 箇所／番号 |
| --- | ---: | ---: | ---: |
| 1枚まで・アクティブ | 39／36 | 86／67 | 42／31 |
| 1枚まで・レスト | 26／24 | 70／65 | 10／10 |
| 2枚まで・アクティブ | 1／1 | 1／1 | 0／0 |
| 2枚まで・レスト | 5／5 | 8／7 | 1／1 |
| 3枚まで・レスト | 2／2 | 2／2 | 0／0 |
| 4枚まで・アクティブ | 1／1 | 1／1 | 0／0 |
| 4枚まで・レスト | 1／1 | 1／1 | 0／0 |
| 5枚まで・レスト | 0／0 | 1／1 | 0／0 |
| 合計（番号の重複除去） | 75／69 | 170／141 | 53／41 |

既存の構造解析に、明示されたDON!!デッキからの任意追加を足した。単独、既存のライフ・手札枚数条件、既存構文で対象・順序を保持できる連続処理を扱う。ドロー・KO・レストの直後につながる表記も、先行処理が既存の解析に通る場合だけ変換する。例：EB01-039のトリガー、OP16-063のレストで2枚まで、ST04-014のドロー後、ST04-015のKO後。元のPR22照合に一致する21番号で少なくとも1箇所を変換した。条件・支払い・未対応の後続処理が残る文はDON!!の部分だけ生成しない。1・2枚以外の表で変換0のものも、上限が未対応なのではなく、周辺の条件等が未解釈。

## PR23との比較

| 指標 | PR23 | PR24 |
| --- | ---: | ---: |
| 全番号 | 2,885 | 2,885 |
| 完全生成・Compiler成功 | 435 | 447 |
| うち効果なし | 291 | 291 |
| 部分生成 | 487 | 505 |
| 生成不能 | 1,802 | 1,772 |
| 未判定（生成側） | 161 | 161 |
| 未解釈箇所 | 3,434 | 3,379 |
| PR18の対応候補 | 422 | 434 |
| 既存承認 | 14 | 14 |

55箇所の改善のうち53箇所は任意DON!!追加、2箇所は本文が確定したメイン呼び出し。後者の2番号は前者の影響番号と重複する。PR23の完全生成435件は定義hashまで一致。表記拡張後の残り117箇所／103番号は、任意追加命令の不足ではなく、文全体の未解釈として残す。PR22方式の確認済みRuntime不足は162箇所／147番号から87箇所／80番号へ。Compiler成功はカードの意味レビューや承認を表さない。

```powershell
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed local-data/v3-review-ledger-pr00-20261029/source.csv local-data/v3-drafts-pr24-next --ledger local-data/v3-review-ledger-pr00-20261029/review-ledger.json
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-pr23-report local-data/v3-drafts-pr24-next local-data/v3-drafts-pr24-next-diff
node tools/analyze-v3-draft-blockers.js local-data/v3-review-ledger-pr00-20261029/source.csv local-data/v3-drafts-pr23-report/generation.json local-data/v3-drafts-pr24-next/generation.json local-data/v3-drafts-pr24-next-blockers
```

実行済み出力は `local-data/v3-drafts-pr24-report/`、`local-data/v3-drafts-pr24-vs-pr23/`、`local-data/v3-pr24-blockers/`。いずれもGit管理外。

## 互換性・変更ファイル

- Compiler `v3-subset-compiler.46.1`、Registry `6fa4152663a7928665f6791d0ed9382f031f9c90e598b4f9c56ce5b1e2017cff`。旧subset.45のRegistry `51aede513907ed81439477ca59f2410e2931c38f6288713439e744aef671274f` と既存14枚の承認・旧hashは変更なし。通常対戦・一人回し、元CSV、承認カタログも変更なし。
- 関連77件、全回帰987件成功（失敗・スキップ0）。フロント・サーバービルド、生成Schemaの差分チェック、新規完全生成12件のSchema検証も成功。変更24ファイル（生成Schema・Registry一覧を除く22ファイル、+348/-54行）。
- 保留：場のDON!!枚数比較、複数タイミング、複雑な条件やコストを含む原文の自動生成。新規承認なし。

| 区分 | 変更ファイル |
| --- | --- |
| 隔離v3 | `server/src/test/effects/v3/{compiler,conditionalTriggers,dsl,fixtureCoordinator,fixtureEnvironment,matchCoordinator,replacementPlans,resolution,simpleMainEvent}.ts` |
| 生成・比較・監査 | `tools/{generate-v3-drafts,v3-draft-structure,analyze-v3-coverage,analyze-v3-draft-gaps,analyze-v3-draft-blockers}.js` |
| Schema・Registry | `tools/build-v3-optional-don-schema.js`、`tools/build-v3-optional-don-inventory.cjs`、`schemas/effect-v3-subset46.schema.json`、`docs/card-effect-supported-operations.json`、`docs/validate-card-effect-json.cjs` |
| テスト | `server/test/v3-don-effects.cjs`、`tools/{test-v3-optional-don-schema,test-v3-drafts,test-v3-draft-blockers}.test.js` |
| 報告 | `docs/card-effect-pr24.md` |
