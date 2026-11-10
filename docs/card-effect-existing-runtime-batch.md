# 既存Runtimeを使ったカード定義の一括生成

基準: `786e4b0`、生成器: `v3-draft-generator.11`。公式CSVの全2,885番号を対象とした。Runtime、DSL、Compiler、Schema、Registry、承認カタログ、通常対戦、一人回しは変更していない。

## 生成結果

| 指標 | 変更前 | 変更後 |
| --- | ---: | ---: |
| 完全生成・Compiler成功 | 706 | 815 |
| 部分生成 | 575 | 583 |
| 生成不能 | 1,421 | 1,293 |
| 未判定 | 183 | 194 |
| 効果なし（完全生成の内数） | 291 | 291 |
| 未解釈箇所 | 2,865 | 2,673 |
| Schema・Compiler検証済み未承認JSON | 692 | 801 |
| 承認済み | 14 | 14 |

新規完全生成109番号はすべて生成器の変更による。個別手書き定義は0件。既存の完全生成706件はステータス・定義ハッシュ・原文ハッシュが全件一致した。本文の解釈が進んでも印刷メタデータなどが足りない場合は完全生成にせず、未判定に残す。生成案は承認や全カードの挙動検証を意味しない。

## 主な対応と意味照合

影響番号には部分生成や保留のカードも含み、機能間の重複を許す。カード別・パターン別の差分は下記のローカル出力を参照。

| 新しく認識した構造 | 影響番号 | うち新規完全生成 |
| --- | ---: | ---: |
| 範囲・状態・特徴などで絞る盤面操作、リーダー／キャラ共通上限 | 37 | 27 |
| 発動コストの読み分け（印刷されたレスト記号、手札からの指定枚数の公開・破棄など） | 29 | 20 |
| 自分のコストエリアのDON!!をアクティブ／レストにする | 23 | 18 |
| 発動元自身の状態変更・期間付き補正 | 21 | 13 |
| 公開トラッシュから条件付きで手札へ | 20 | 9 |
| DON!!付与先・対象の指定 | 10 | 7 |
| 非公開サーチの対象条件 | 9 | 5 |
| 公開領域の枚数条件や条件の組み合わせ | 7 | 4 |
| 複数行のモード選択 | 4 | 3 |

- `OP01-031`: ターン1回、指定特徴の手札1枚を発動コストとして破棄する。その後、レストの自分のDON!!から0〜2枚を選んでアクティブにする。付与DON!!やデッキは候補にしない。[公式総合ルール 8-3・8-4](https://onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260109=)、[公式スターターQ&A ST02-008](https://www.onepiece-cardgame.com/pdf/qa_st-01-st-04.pdf?v220801=)。
- `OP02-063`: 自分の公開トラッシュでコスト1・青・イベントの全条件を満たす候補を、自分で0〜1枚選んで手札へ移す。
- `EB02-007`: リーダーとキャラを同じ候補集合にまとめて、合計0〜3枚を選択する。ターン中のパワー補正の後に相手キャラのKOを処理する。別欄のライフトリガーには補正を入れない。
- `OP06-021`: ターン1回の起動メイン。レストかコスト減少のいずれか一方を選び、その枝だけを実行する。枝を全部解釈できない原文は採用しない。原文の行境界と各枝の位置を追跡できる。
- 「次の相手のターン終了時」は、既に相手ターンならその終了時を指すため、相手側の最初の `TURN_END` に対応付けた。[公式カードQ&A OP01-085](https://www.onepiece-cardgame.com/pdf/qa_op01.pdf?20220930=)。

## 保留と互換性

- `OP05-020`: 既存subset.44ではイベントMAINの `CHOOSE_MODE` をCompilerが受理するが、Schemaの `interactiveMainEventAction` は許可しない。定義を変えずにSchema適合へ変えることはできないため、ハッシュ `b6894ce5cc8b1b850d23e07dc942f51e5d9e65ab7ac6afd78baf395d01c7e1ef` を維持し、検証済み個別出力から従来どおり除外した。Schema保留はこの既存1件のみ。
- 同種の差異があるイベントMAINのライフ移動・モード選択は今回の生成規則では保留。非公開デッキ閲覧やトラッシュ選択を伴うイベントMAINも現行の実行契約の対象外。相手DON!!の状態操作、シャッフル、バトル終了時誘発、ダメージ置換、効果登場の満枠処理などにはRuntimeを追加していない。
- 版差や印刷情報不足、複雑なコスト・条件の係り先、未確認の期限や選択権限は推測で変換していない。

## 出力・検証

ローカルの `local-data/v3-drafts-existing-runtime-11/definitions/` に1カード1JSONで801件を出力（新規109件、すべて `needs_review`）。集計は同階層の `generation.json`、保留は `definition-export.json`。カード別の遷移・ハッシュ差分と保留パターンは `local-data/v3-drafts-existing-runtime-diff-11/`。CSVと生成物はGitに含めない。

```powershell
$env:NODE_PATH = (Resolve-Path 'node_modules/workbox-build/node_modules').Path
$source = 'local-data/v3-review-ledger-pr00-20261029/source.csv'
$ledger = 'local-data/v3-review-ledger-pr00-20261029/review-ledger.json'
$output = 'local-data/v3-drafts-existing-runtime-11'
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed $source $output --ledger $ledger --definitions validated
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-json-batch $output local-data/v3-drafts-existing-runtime-diff-11
```

再実行時は未作成の出力ディレクトリを指定する。既存のサーバーコンパイル済みファイルとAjv 8を利用する。

関連テスト88件成功（失敗・スキップ0）。生成器、差分・対応率集計、承認カタログ、DON!!・支払いを検証した。生成したDON!!状態変更・トラッシュ回収を既存Runtimeで実行し、選択前に盤面を変えないこと、選択権限、対象・移動先を確認した。全回帰・両ビルドは実行していない。

変更ファイル: `tools/generate-v3-drafts.js`、`tools/v3-draft-compound.js`、`tools/v3-draft-recipes.js`、`tools/analyze-v3-coverage.js`、`tools/analyze-v3-draft-gaps.js`、`tools/test-v3-drafts.test.js`、`tools/test-v3-draft-recipes.test.js`、本報告書。
