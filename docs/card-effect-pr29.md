# PR29: 複合効果・条件・対象選択

## 実装範囲

- 複数タイミング：共通本文を登場時／アタック時、登場時／KO時、メイン／カウンターの個別の効果に変換する。共有ターン1回など追加指定のあるものは分割しない。各タイミングの既存の発動入口を使い、同時に起動しない。
- 公開対象：既存の `CARDS` を使い、リーダー・キャラ・ステージの複数領域、または両席の公開カードを一つの候補集合にできる。上限は集合全体に一度だけ適用する。`EITHER` は所有者と操作者の範囲にのみ使え、選択者は必ず個別の席。候補とトークンは選択者にのみ表示する。明示的な1枚指定では候補が存在しない場合に限り後続へ進める。
- 持ち主への移動：`MOVE_CARD` の `CARD_OWNER` は選択した公開のキャラ／ステージから実際の所有者を解決する。手札かデッキ下に限定し、デッキ下は順番未定義の複数枚を許可しない。原文で所属を指定しない手札戻しは両席を候補にする。[公式カードQ&A OP01-086・OP01-089](https://www.onepiece-cardgame.com/pdf/qa_op01.pdf?20220930=)
- 条件・順序：既存 `IF`／`all`／`any` と公開リーダー検索を再利用し、ライフ合計参照 `BOTH.lifeCount` を追加した。「その後」の条件は前の操作が完了した時点の値で評価し、対象や枚数を引き継ぐとの指示がなければ改めて選ぶ。
- 支払い：手札の固定枚数捨て、DON!!返却、自身のレストを明示するコロン前の文は発動コストにする。効果本文の任意捨てと「そうした場合」は `OFFER_PAYMENT` と `IF_PAYMENT_SUCCEEDED` に分ける（代表fixtureで検証、このCSVで完全に認識した該当本文は0）。判定・選択待機・原子的な適用は既存Runtimeを再利用する。
- ライフトリガー：自己登場の発動コストに、手札捨てまたはDON!!返却を一つだけ認める。支払い不能なら公開前に拒否し、手札に取る経路を維持する。宣言済みの発動元は従来どおり解決領域へ移すが、コスト対象と場は選択を確定するまで変更しない。支払いを確定した後に条件を判定し、失敗なら従来のトリガー終了処理へ。コストなしの「ドロー→条件付き自己登場」も既存の `DRAW`／`IF`／`PLAY_TRIGGER_SOURCE` を使う。[公式総合ルール §8-3、§8-4、§8-6-2、§10-1-5](https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf)

通常対戦・一人回し、公式CSV、承認カタログは未変更。既存14枚の承認・旧プロファイルを維持し、新規承認は行わない。

## 分析・生成結果

PR28の未完了2,405番号を対象とし、原文のある2,388番号・3,275箇所をPR26と版ハッシュ・位置で照合。原文の未解釈箇所を持たない17番号の保留理由も別に記録した。新しく認識できたのは重複除外で224番号・242箇所。採用した経路は既存DSLの組み合わせ（A）が122番号・127箇所、小規模拡張を使用（B）が104番号・115箇所。残る箇所はCとして保留するが、全件が新機能を必要とするとの判定ではない。未調査・意味未確認も含む。

| 監査上の機能群 | 対象番号 | 該当箇所を新規認識 | 同群で未解釈箇所が残る |
| --- | ---: | ---: | ---: |
| 複数タイミング | 43 | 13 | 30 |
| 所有者・操作者・選択者 | 40 | 37 | 3 |
| ライフトリガー自己登場 | 42 | 37 | 5 |
| 条件（単独・複合） | 1,382 | 104 | 1,300 |
| 順序付き処理 | 690 | 32 | 659 |
| 支払い関連 | 894 | 90 | 810 |
| 既存機能の組み合わせと判定されたもの | 15 | 9 | 6 |

機能群・対応と保留は重複する。同じ番号が複数の未解釈箇所を持つ場合がある。機能群の監査タグを超えて、所有者への戻しの新構文は42番号、条件付き後続処理は16番号、発動コストの新構文は盤面効果63番号／ライフ自己登場28番号で認識した。

| 指標（全2,885番号） | PR28 | PR29 |
| --- | ---: | ---: |
| 完全生成・Compiler成功 | 480 | 610 |
| うち効果なし | 291 | 291 |
| 部分生成 | 530 | 568 |
| 生成不能 | 1,711 | 1,535 |
| 未判定 | 164 | 172 |
| 未解釈箇所 | 3,275 | 3,033 |
| 対応候補 | 467 | 597 |
| 承認済み | 14 | 14 |

完全生成480件の定義ハッシュは全件一致。新規130件はCompiler・JSON Schema双方に適合。未判定が8件増えたのは、本文の解釈が進んでも印刷メタデータの不足が残ったため。完全生成は意味レビューや承認を保証しない。

## 代表照合と保留理由

- `EB01-046`：登場とアタックを別発動にし、先に選んだキャラのコストを下げ、その後のコスト0判定で対象を選び直す。
- `OP04-038`：メインとカウンターを別入口にし、リーダー／キャラ合計最大1枚をレスト。その結果を反映して、別の選択でコスト6以下のレストのキャラを最大1枚KOする。
- `OP01-086`：自分側のバトル中補正が先。次の手札戻しは両席の条件内キャラが候補で、実際の所有者の手札に戻す。
- `OP04-064`：追加するDON!!の枚数を選び、処理完了後の場の枚数でドローの有無を判定。`OP07-107` は逆に先にドローし、残りライフ条件が不成立でもドローは取り消さない。
- 保留：複数タイミングで共有する使用回数、アタック制限やブロッカー無効化、相手デッキの非公開閲覧、追加支払いとしてのライフ上下の選択、条件としてのリーダーの多色、先行処理が全体パワー変更の自己登場、登場先や選択者の解釈が未確定な文。複合支払いを部分的に支払う変換や、勝利条件を別の効果へ置き換える変換はしない。

## 再実行

```powershell
npm --prefix server run build
node tools/build-v3-compound-profile.cjs --check
$source = 'local-data/v3-review-ledger-pr00-20261029/source.csv'
$ledger = 'local-data/v3-review-ledger-pr00-20261029/review-ledger.json'
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed $source local-data/v3-drafts-pr29-report --ledger $ledger
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-pr28-report local-data/v3-drafts-pr29-report local-data/v3-drafts-pr29-vs-pr28
node tools/analyze-v3-draft-details.js $source local-data/v3-drafts-pr28-report/generation.json local-data/v3-drafts-pr29-report/generation.json local-data/v3-pr29-report
node tools/analyze-v3-compound.js local-data/v3-pr26-report/details.json local-data/v3-pr28-report/details.json local-data/v3-drafts-pr28-report/generation.json local-data/v3-drafts-pr29-report/generation.json local-data/v3-pr29-compound-final
```

出力先は未作成のディレクトリを指定する。`analysis.json` は版ごとの原文・位置・分類理由・前後の生成状態を保持する。ローカルの生成レポートはGit管理外。Schema `3.0.0-subset.49`、Compiler `v3-subset-compiler.49.1`、Registry SHA-256 `83e54913141f38d9a0f7688fe001e9c97331b90f79a95b3c1e7d008aab4ec0a5`。

全回帰1,012件成功（失敗・スキップ0）。フロント・サーバービルド、subset.47/.48/.49の生成物照合、新規130件のSchema検証も成功。共通上限、不正な選択・公開範囲、所有者と操作者が異なるカード、支払い不足・再送、各発動タイミングの分離を検証した。

## 変更ファイル

- 隔離v3: `server/src/test/effects/v3/{compiler,conditionalTriggers,dsl,fixtureCoordinator,fixtureEnvironment,lifeTriggers,matchCoordinator,replacementPlans,resolution,simpleMainEvent,triggerSelfPlay}.ts`。
- 生成・分析: `tools/{analyze-v3-compound,analyze-v3-coverage,analyze-v3-draft-blockers,analyze-v3-draft-details,analyze-v3-draft-gaps,generate-v3-drafts,v3-draft-compound,v3-draft-diagnostics,v3-draft-structure,v3-trigger-self-play}.js`。
- プロファイル・検証: `tools/{build-v3-compound-profile,build-v3-conditional-trigger-play-profile}.cjs`、`docs/validate-card-effect-json.cjs`。
- テスト: `server/test/{v3-compound,v3-trigger-play}.cjs`、`tools/{test-v3-compound-schema,test-v3-draft-blockers,test-v3-draft-details,test-v3-drafts}.test.js`。
- 報告・生成物: `docs/card-effect-pr29.md`、`docs/card-effect-supported-operations.json`、`schemas/effect-v3-subset49.schema.json`。
