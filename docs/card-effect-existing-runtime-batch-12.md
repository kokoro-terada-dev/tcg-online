# 既存Runtimeでのカード効果JSON一括生成

基準コミット: `a7de480`。生成器: `v3-draft-generator.12`。公式CSVの全2,885番号を同一データで再集計した。Runtime、DSL、Compiler、Schema、Registry、承認処理、対戦・一人回しの画面は変更していない。

| 指標 | 変更前 | 変更後 |
| --- | ---: | ---: |
| 完全生成 | 815 | 903 |
| 部分生成 | 583 | 570 |
| 生成不能 | 1,293 | 1,212 |
| 未判定 | 194 | 200 |
| 未解釈箇所 | 2,673 | 2,542 |
| 未承認の個別JSON出力 | 801 | 890 |
| 承認済み | 14 | 14 |

新規完全生成89番号はすべて生成器による。個別手書き定義は0件。完全生成の純増が88件なのは、従来のCompiler集計に含まれた `OP05-020` を、今回のSchema必須集計から除外したため。カード定義・原文のハッシュは従来の815件すべてで一致し、既存の個別JSON 801件も同一。承認記録14枚は全件一致。新規JSONは実行可能な承認定義ではない。

## 対応範囲

- 公開盤面のキャラの存在・不在・枚数、状態やメタデータを含む条件を既存の `EXISTS`、`COUNT`、`IF` に変換した。公知領域の条件だけを追加し、対象範囲が省略されている集計は推測しない。
- 複数種類・名称のサーチ条件を型とフィルターの組み合わせで表現する。各候補に別々の枚数上限を作らず、1回の選択で共通上限を適用する。例: `EB03-010` はパワー条件をキャラにだけ適用し、イベントには適用しない。
- 対象を持ち主のデッキ下へ送る操作では順序が一意な1枚までを対象とした。相手の盤面から直接トラッシュへ置く操作は `MOVE_CARD` とし、`KO` に読み替えない。
- フィールド効果のターン1回、既存の誘発タイミング、既存コストで表現できる複合支払いを保持する。例: `EB01-037` は相手のアタック時のターン1回を維持し、DON!!返却コストとKO対象の選択を分ける。
- 単純な公開盤面の継続パワー・コスト補正を既存の `CONTINUOUS_EFFECT` に変換した。現在値を印刷値へ読み替えない。既に解釈したキーワード付与に続く定型注記は、その付与の説明として紐付け、印刷キーワードを増やさない。

## 保留

- `OP05-020` は既存Schema・Compilerの不一致を修正せず維持。個別JSON・完全生成集計から除外し、ハッシュと検証エラーは出力に残した。
- 本文の解析が進んだ一方、印刷メタデータを確認できない5番号は未判定に残した。版差や不明な裁定・対象の範囲は引き続き保留。
- 相手DON!!操作、シャッフル、バトル終了時誘発、ダメージ置換、山札を事前閲覧せず直接トラッシュへ置く処理、動的な継続条件、許可外のイベントMAIN操作は、別操作への置き換えで意味を変えないため保留。

## 出力・静的検証

`local-data/v3-drafts-existing-runtime-12/definitions/` に未承認890件を出力した。構文・既存Schema・既存Compilerの検証を実施し、新規89件すべての個別出力を確認した。差分は `local-data/v3-drafts-existing-runtime-diff-12/` の `card-diff.csv`、`gap-groups.csv`、`gap-diff.json`。生成物・原資料はGitに含めない。**単体・統合・回帰・E2Eテストおよびビルドは未実施。既存テストファイルにも変更なし。**

```powershell
$env:NODE_PATH = (Resolve-Path 'node_modules/workbox-build/node_modules').Path
$source = 'local-data/v3-review-ledger-pr00-20261029/source.csv'
$ledger = 'local-data/v3-review-ledger-pr00-20261029/review-ledger.json'
$output = 'local-data/v3-drafts-existing-runtime-12'
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed $source $output --ledger $ledger --definitions validated
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-existing-runtime-11 $output local-data/v3-drafts-existing-runtime-diff-12
```

再生成は新規の出力ディレクトリを指定する。既存コンパイル成果物とAjv 8が必要。

変更ファイル: `tools/generate-v3-drafts.js`、`tools/v3-draft-compound.js`、`tools/v3-draft-recipes.js`、`tools/analyze-v3-coverage.js`、`tools/analyze-v3-draft-gaps.js`、本報告書。
