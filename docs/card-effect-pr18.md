# PR18: カード効果の対応率分析

## 入力・実行

PR17の索引付き承認カタログとCSV差分、PR00の監査台帳を再利用する。入力CSVのバイト列をSHA-256で固定し、`--ledger` を指定したときは再生成した台帳と既存台帳の全項目を照合する。入力と承認ファイルは読み取りのみ。

```powershell
npm --prefix server run build
node tools/analyze-v3-coverage.js server/data/effects-v3-reviewed local-data/v3-review-ledger-pr00-20261029/source.csv local-data/v3-coverage-next --ledger local-data/v3-review-ledger-pr00-20261029/review-ledger.json
```

新規出力ディレクトリにカード番号別の `coverage.csv`、件数集計の `summary.csv`、集計・割合の `summary.md` を作る。既存ディレクトリや承認ディレクトリには書き込まない。カード別CSVは、表示ID・カード名・原文とトリガーの別版・出典URL・CSV/原文ペアのSHA-256・レコード番号、既存承認・追加の未承認表示ID、DSL案・Compiler・Runtimeプロファイルの結果、未対応・UNKNOWN・裁定保留の証拠を記録する。

## 分類

| 分類 | 判定 |
| --- | --- |
| 承認済み | 既存承認に記録された表示ID・原文・印刷情報を確認できる。原文・印刷情報が同じでも、追加された表示IDは承認されない。 |
| 対応候補 | 手動で供給したDSL案がコンパイルに成功し、現行Runtimeと互換のプロファイルで、出典との照合も通る。意味の確認・効果の実行は未検証。 |
| 一部対応 | DSL案が上記の検証を通り、未対応部分の根拠と、対応済み部分のレビュー証拠の両方がある。 |
| 未対応 | 明示的な未対応機能を確認した。根拠がないカードや、単にコンパイルに失敗したカードは含めない。 |
| 要裁定 | 原文・トリガーの別版が競合するか、意味・裁定の要確認箇所が指定されている。 |
| 未判定 | 入力異常、DSL案なし、不正な案、出典違い、UNKNOWN、確認材料不足など。 |

要裁定・入力隔離・UNKNOWNは対応候補へ昇格しない。既存承認に対しても衝突は分類側に出し、旧承認自体は上書きしない。CSVに含まれない承認は集計母数に入れず、別件数として報告する。

## 検証候補の指定

`--candidates <候補JSON>` は任意。ルートに `version: "v3-coverage-candidates.1"`、`sourceCsvSha256`、現行の `registryHash`、`cards` を持たせる。各カードは `cardId` と監査台帳の原文ペア `variantSha256` が必須。任意の `definition` は既存DSLのカード定義、`findings` は以下の形式。元データの該当フィールドに含まれない引用や、古いCSV・Registryの根拠は拒否する。

```json
{
  "kind": "unsupported",
  "feature": "effect-deck-shuffle",
  "field": "text",
  "quote": "デッキをシャッフルする。",
  "evidence": "効果解決のアクションにデッキのシャッフルがないことを確認"
}
```

`kind` は `unsupported` / `ruling` / `unknown`、`field` は `text` / `triggerText`。一部対応を主張する場合は、別にカード単位の `supportedEvidence` を記録する。案の `reviewStatus` やCompiler成功は承認として使わない。

自動集計は現行Registryに固定した限定的な明示文言のみ。効果内のシャッフル、バトル終了時の誘発、被ダメージ置換を、既存の対戦準備のシャッフル・バトル終了期限・カード移動置換と混同しない。全文の意味推定やカード番号固有の分岐はない。影響数は機能ごとにカード番号を重複排除する。

## 実データの結果

- 2,885番号: 承認済み14、対応候補0、一部対応0、未対応13、要裁定139、未判定2,719。承認済みは元CSVの0.49%。今回の入力にDSL案は含めていない。
- 検出した未対応機能: 効果によるデッキのシャッフル9、バトル終了時の誘発3、被ダメージの置換1。これ以外の未対応機能が存在しないという意味ではない。
- 今回のレポートはGit対象外の `local-data/v3-coverage-pr18-report/` に出力した。カード効果、承認データ、Compiler・Registry・Runtime、通常対戦・一人回しは変更していない。

## 検証・変更ファイル

- 関連19件成功。全回帰は一括957件成功（失敗・スキップ0）。フロント・サーバーのビルドは各1回成功。
- 集計: 5ファイル（新規3、既存2）、生成物を除き+387/-6行。

| 区分 | 変更ファイル |
| --- | --- |
| 分析 | `tools/analyze-v3-coverage.js` |
| PR17・監査処理の再利用 | `tools/review-v3-catalog.js`、`tools/audit-effect-cards.js` |
| テスト | `tools/test-v3-coverage.test.js` |
| 報告 | `docs/card-effect-pr18.md` |
