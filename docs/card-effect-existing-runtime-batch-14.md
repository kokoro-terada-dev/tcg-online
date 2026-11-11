# 既存DSLによる生成と残件の再評価

基準: `e9c74a4`。生成器: `v3-draft-generator.14`。公式CSVの同一2,885番号を対象に生成、静的検証、残件の再分類を反復した。以下は検証済みの最終出力であり、既存DSLで表現できる全カードを網羅したという意味ではない。

| 指標 | 変更前 | 変更後 |
| --- | ---: | ---: |
| 完全生成 | 935 | 964 |
| 部分生成 | 569 | 566 |
| 生成不能 | 1,177 | 1,149 |
| 未判定 | 204 | 206 |
| 未解釈箇所 | 2,484 | 2,440 |
| 未承認の個別JSON | 922 | 951 |

新規完全生成・純増とも29件。生成器29件、個別手書き0件。既存命令によるDON!!返却誘発・レスト支払い、効果KOに対する支払い付き置換、退場コストで空き枠を確保した後の手札からの登場、多色条件、同じ対象への追加補正、相手のアタック時の任意発動などを追加した。明示的な退場コストを持たない満枠の登場は、[公式Q&A](https://www.onepiece-cardgame.com/pdf/qa_op01.pdf?20220930=) と既存 `PLAY_BY_EFFECT` の空き枠制限が異なるため、代替処理を入れていない。

## 残件と終了判定

- **既存DSLで全効果を表現可能と確認した未処理番号は0件。** Aの3番号は `MOVE_LIFE` で書ける選択肢単体を持つが、どの番号も相手がモードを選ぶ必要がある。既存 `CHOOSE_MODE` の選択者は効果の操作者で、選択権を逆転できない。B（組み合わせで全効果を表現可能と確認した残件）は0件。
- **機能不足を確認したCは563番号。** 機能別（重複あり）: 発動元個体に付与したDON!!枚数222、満枠時の効果登場121、トラッシュからの効果登場56、事前閲覧なしの山札から直接トラッシュ47、イベントMAINの非公開デッキ操作45、登場時・KO時・カウンター本文へのライフトリガーからの呼び出し23、継続効果の発動元個体限定21、カウンターの追加手札支払い14、山札からの効果登場11、シャッフル9、相手DON!!状態変更6、別条件の複数対象を一括KO5、相手によるモード選択5、イベントMAINのモード4、バトル終了時誘発3、自己登場トリガーの色条件3、ダメージ置換1。
- **Dは206番号。** 版差・印刷情報などの要確認205、既知のSchema不一致1。**分類不能は1,203番号**。正規化したパターンはレビューの並べ替えにのみ使い、文節だけで別の効果の参照先や選択者、適用期限を確定しない。
- **終了条件C。** Aの全件完了は宣言しない。分類不能分には、トリガーが呼び出すMAIN本文の全体を確認すべきもの、別行の注記がどの能力に付くかを確認すべきもの、対象の所属・選択権・期限について原文だけで確定できないものが残る。候補が存在しないという結論ではない。再調査は `remaining-unclassified.csv` の影響番号数順に、番号と原文を `generation.json` の同じ版の全本文へ照合し、既存契約で表せることが確認できた場合だけ生成を行う。

## 静的検証・出力

新規29件はJSON構文、既存Schema・Compilerに適合。既存935件の定義・原文ハッシュ、既存個別JSON 922件、承認済み14枚の承認記録は全件一致。完全生成964件は個別出力951件と、出力対象外の既承認13件の合計。既承認 `ST02-001` は生成数外、`OP05-020` は既知のSchema不一致で集計・個別出力から除外。新規承認なし。Runtime、DSL、Compiler、Schema、Registry、承認処理、対戦・一人回し画面、既存テストに変更なし。**テスト・ビルドは未実施。**

- 個別JSON・生成集計: `local-data/v3-drafts-existing-runtime-14-checked/`
- カード別差分: `local-data/v3-drafts-existing-runtime-diff-14-checked/`
- 分類・原文根拠・未分類一覧: `local-data/v3-drafts-existing-runtime-reasons-14-checked-final/`

```powershell
$env:NODE_PATH = (Resolve-Path 'node_modules/workbox-build/node_modules').Path
$source = 'local-data/v3-review-ledger-pr00-20261029/source.csv'
$ledger = 'local-data/v3-review-ledger-pr00-20261029/review-ledger.json'
$out = 'local-data/v3-drafts-existing-runtime-14-rerun'
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed $source $out --ledger $ledger --definitions validated
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-existing-runtime-13-validated $out "$out-diff"
node tools/analyze-v3-remaining-reasons.js "$out/generation.json" "$out-reasons"
```

既存コンパイル成果物とAjv 8を使う。生成物・原資料はGitに含めない。変更ファイル: `tools/generate-v3-drafts.js`、`tools/v3-draft-completion.js`、`tools/analyze-v3-coverage.js`、`tools/analyze-v3-draft-gaps.js`、`tools/analyze-v3-remaining-reasons.js`、本報告書。
