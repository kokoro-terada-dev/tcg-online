# PR25: 既存DSLで表現可能な対象・数値条件の生成漏れ

## PR22の22番号を照合

`local-data/v3-pr22-report/findings.csv` の `explicit-target-or-stat` を再抽出し、カード番号・版hash・原文フィールド・開始／終了位置でPR24と照合した。22番号・23箇所のうちPR24で解消済みは0、未解消は23箇所。PR25で23箇所すべてを解釈した。カード全体の分類は以下のとおり。

| PR25の状態 | 番号数 | カード番号 |
| --- | ---: | --- |
| 完全生成 | 11 | EB01-010、OP02-096、OP02-117、OP16-013、OP17-016、P-026、ST06-005、ST06-008、ST06-010、ST08-008、ST35-001 |
| 部分生成 | 9 | OP03-095、OP05-041、OP10-019、OP11-038、OP11-080、OP11-114、OP17-009、OP17-014、ST06-017 |
| 未判定 | 2 | OP02-106、ST08-006 |

部分生成は別の効果文が残っているため。未判定2番号は本文を読み切ったが、印刷パワー欄が `-` のため `printed-metadata-unconfirmed`。OP02-106は全6表示ID、ST08-006は1表示IDで同じ表記を確認した。数値は補わない。

## 追加した構造と代表照合

| 構造 | 箇所／番号 | 代表例と出力 |
| --- | ---: | --- |
| このターン中のキャラのコスト補正 | 13／13 | OP02-096: 相手のキャラ最大1枚を選び、`MODIFY_STAT(cost, -4)`。解決時のターンプレイヤーの `TURN_END` で失効。 |
| 相手リーダーまたはキャラを合計最大1枚 | 10／10 | OP01-026: トリガーで相手のいずれかを最大1枚、ターン中パワー-10000。`CHOOSE_MODE` と各領域0～1枚の `SELECT` を使う。 |
| 「元々の」コスト／パワーの対象フィルター | 9／8 | EB01-010: カウンターは基礎パワー6000以下、トリガーは5000以下の相手キャラ最大1枚をKO。効果ごとの閾値を保持。 |
| リーダー1枚までの任意選択 | 6／6 | OP10-019: カウンターで自分のリーダーを0～1枚選び、バトル中パワー+3000。固定の1枚とは区別。 |

「元々の」はPR22の説明にあった印刷値固定ではなく、既存の `CANDIDATE.base` を使う。基礎値設定がなければ印刷値であり、設定がある場合は基礎値に反映する。通常の増減や付与DON!!を含む現在値は `CANDIDATE.current` として別に読む。[公式総合ルール §4-8、§4-9、§4-10](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)

PR22の原因未特定2,347番号について、全件を個別に再判断せず、頻度上位グループを今回の構文と照合した。相手リーダー／キャラへのパワー減少のトリガー（同型5番号）や、前段のバトル補正後に別のターン中補正を行う文などを確認。結果として、PR22の原因未特定に入っていた15番号の15箇所を追加解釈した。条件のないキーワード注釈単体、効果本文が未確定のメイン呼び出し、追加支払い付きの文、場のDON!!枚数条件やデッキからの破棄には広げていない。

## 全2,885番号の比較

| 指標 | PR24 | PR25 |
| --- | ---: | ---: |
| 完全生成・Compiler成功 | 447 | 464 |
| うち効果なし | 291 | 291 |
| 部分生成 | 505 | 514 |
| 生成不能 | 1,772 | 1,744 |
| 未判定 | 161 | 163 |
| 未解釈箇所 | 3,379 | 3,341 |
| PR18の対応候補 | 434 | 451 |
| 既存承認 | 14 | 14 |

新たに解釈したのは計37番号・38箇所。PR24の完全生成447件は定義hashまで一致した。新規完全生成17件は対応Schemaでも検証済み。Compiler成功と全カードの意味レビュー・承認は別。既存のSchema・Compiler・Registry・Runtime、既存14枚の承認・旧hash、通常対戦・一人回し、元CSV、承認カタログは変更していない。

## 再現と変更ファイル

```powershell
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed local-data/v3-review-ledger-pr00-20261029/source.csv local-data/v3-drafts-pr25-next --ledger local-data/v3-review-ledger-pr00-20261029/review-ledger.json
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-pr24-report local-data/v3-drafts-pr25-next local-data/v3-drafts-pr25-next-diff
node tools/analyze-v3-draft-blockers.js local-data/v3-review-ledger-pr00-20261029/source.csv local-data/v3-drafts-pr24-report/generation.json local-data/v3-drafts-pr25-next/generation.json local-data/v3-drafts-pr25-next-blockers
```

実行済み出力は `local-data/v3-drafts-pr25-report/`、`local-data/v3-drafts-pr25-vs-pr24/`、`local-data/v3-pr25-blockers/`。カードごとの差分は `card-diff.csv`。生成物はGit管理外。関連35件・全回帰990件成功（失敗・スキップなし）。フロントとサーバーのビルド成功。8ファイル、生成物を除き+164/-19行。

| 区分 | 変更ファイル |
| --- | --- |
| 生成器 | `tools/v3-draft-structure.js`、`tools/generate-v3-drafts.js` |
| 集計 | `tools/analyze-v3-coverage.js`、`tools/analyze-v3-draft-gaps.js`、`tools/analyze-v3-draft-blockers.js` |
| テスト | `tools/test-v3-drafts.test.js`、`tools/test-v3-draft-blockers.test.js` |
| 報告 | `docs/card-effect-pr25.md` |
