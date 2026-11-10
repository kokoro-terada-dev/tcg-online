# 共通エンジンとカード定義の分離

基準コミット: `08c76a7`。この作業ではRuntime、DSL、Compiler、Schema、Registry、承認カタログを変更していない。

## 現行構造と責務

| 層 | 入口 | 責務 |
| --- | --- | --- |
| 公式カードデータ | `tools/build-v3-review-ledger.js` | CSVの原文・表示ID・版・出典を保持。 |
| 日本語生成器 | `tools/generate-v3-drafts.js`、`tools/v3-draft-*.js` | 既存DSLの組み合わせを生成。未解釈箇所が残れば完全な定義として出力しない。 |
| カードJSON | `definitions/<カード番号>.json`（レビュー用） | 条件、選択者、枚数、支払い、効果の順序を宣言。実行可能な承認とは別。 |
| 共通エンジン | `server/src/test/effects/v3/{compiler,resolution,fixtureCoordinator}.ts` | DSLを解釈し、既存の選択待機、検証、移動トランザクションへ接続。 |
| 承認と起動 | `server/src/test/effects/v3/{approval,reviewedCatalog}.ts` | 承認済み定義・原文・プロファイルの一致を検証して読み込む。レビュー候補は読み込まない。 |

現行の隔離v3は、上記の責務分離をすでに持つ。実行経路に公式カード番号をハードコードした分岐は今回の調査範囲で見つからなかった。Runtimeでのカード番号比較は、定義の検索や個体・世代・承認の整合性確認であり、カード別の処理選択ではない。既存命令をつなぐだけで表現できる効果に、追加のハンドラーは不要。

## A/B/C/D と今回の結果

- **A: JSONのみ**。既存の対応候補597件のうち、Schema適合596件を定義ハッシュを変えずに個別出力。これは既存定義の書き出しで、手書きによる新規追加は0件。
- **B: 生成器のみ**。既存処理の組み合わせを生成するようにして、新規96件を完全生成。96件とも個別JSONを出力した。下表は生成できた箇所を含むカード番号の数であり、機能群間で重複する。
- **C: 現行の実行契約では未対応**。手札イベントのMAINでは非公開デッキ閲覧を含む処理が許可されていない。通常の効果登場では満枠の差し替えを表現できず、トラッシュを発生元とする効果登場も対象外。バトル終了時誘発や効果によるシャッフルも別の汎用契約が必要。いずれも今回はRuntimeを変更しない。
- **D: 要確認**。本文・トリガーの版差139番号、条件の係り先や選択者が不明な複合文、印刷メタデータの欠損を保留。`OP05-020` は既存subset.44のCompilerとSchemaでイベントMAINの `CHOOSE_MODE` の扱いが異なるため、元の定義とハッシュを維持し、Schema検証済み出力から除外した。

| 新しく認識した原文の構造 | 番号 |
| --- | ---: |
| 山札上から非公開で閲覧し、選んだカードだけを公開して手札へ、残りを指定順で下へ | 66 |
| 自分の公開リーダー／キャラ1枚にDON!!を付与 | 36 |
| 自身をトラッシュに置くなどの発動コスト | 19 |
| 山札の非公開並べ替え、上／下の指定 | 17 |
| 相手が自分の手札を選んで捨てる／デッキ下へ置く | 8 |
| 単一の起動メインのターン1回指定 | 7 |
| 速攻：キャラの定型注記 | 6 |

代表照合: `EB02-017` の名前除外と特徴条件は `BOUND_CARDS` のフィルターに両方保持する。見る枚数が不足した場合は残りを閲覧し、0枚を選んだ場合は見たカードすべてを順序指定して戻す。[公式カードQ&A OP01-016](https://www.onepiece-cardgame.com/pdf/qa_op01.pdf?20220930=)。`EB01-019` は先にバトル中パワーを変更し、その後のサーチと順序指定を行う。`EB01-007` は付与先の上限1枚とDON!!の選択枚数を別に保つ。

| 指標（全2,885番号） | PR29 | 今回 |
| --- | ---: | ---: |
| 完全生成・Compiler成功 | 610 | 706 |
| 部分生成 | 568 | 575 |
| 生成不能 | 1,535 | 1,421 |
| 未判定 | 172 | 183 |
| 未解釈箇所 | 3,033 | 2,865 |
| 対応候補（Compiler基準） | 597 | 693 |
| 承認済み | 14 | 14 |

未判定の増加11件は、本文の解釈が進み、残った阻害要因が印刷メタデータ不足だけになったもの。PR29で完全生成した610件は定義ハッシュまで全件一致。Schemaに適合しても実カードの意味レビュー・承認は完了していない。実行時に信頼済みの対象メタデータがなければ、既存Runtimeは `UNKNOWN` として扱う。

## 出力と再実行

既存のサーバーコンパイル済みファイルとAjv 8が必要。このワークスペースでは以下で生成できる。出力先は未作成のディレクトリを指定する。

```powershell
$env:NODE_PATH = (Resolve-Path 'node_modules/workbox-build/node_modules').Path
$source = 'local-data/v3-review-ledger-pr00-20261029/source.csv'
$ledger = 'local-data/v3-review-ledger-pr00-20261029/review-ledger.json'
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed $source local-data/v3-drafts-json-batch --ledger $ledger --definitions validated
```

`definitions/` に `needs_review` の692件を出力。承認済み・裁定保留・不完全な定義は対象外。原文と出典ハッシュは各定義、定義ハッシュは `generation.json`、Schemaで保留した定義とエラーは `definition-export.json` に記録する。`--definitions validated` を省略すれば従来どおり集計を出力する。元CSVと生成物はGitに追加しない。

関連テスト105件成功、失敗・スキップなし。生成されたサーチを既存Runtimeで実行し、選択権、選んだカードだけの公開、残りの順序、公開範囲の復元を検証した。692件の個別出力はSchema・Compiler検証済み（新規96件を含む）。既存の承認カタログ検証も通過。変更はJavaScriptの生成・レビュー工具と資料のみのため、全回帰とビルドは実行していない。

## 変更ファイル

- 生成と出力: `tools/generate-v3-drafts.js`、`tools/v3-draft-compound.js`、`tools/v3-draft-structure.js`、`tools/v3-draft-recipes.js`。
- 集計・検証: `tools/analyze-v3-coverage.js`、`tools/analyze-v3-draft-gaps.js`、`docs/validate-card-effect-json.cjs`。
- テスト・資料: `tools/test-v3-draft-recipes.test.js`、`docs/card-effect-engine-definition-boundary.md`。
