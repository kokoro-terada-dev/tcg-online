# PR23: ライフトリガーからの無条件自己登場

## 実装

`3.0.0-subset.45` で `{ "type": "PLAY_TRIGGER_SOURCE" }` を追加。キャラまたはステージの、追加コスト・条件・併記操作のないライフ `TRIGGER` 全体にだけ許可する。クライアントがカード番号・対象・登場先を指定する命令ではない。

1. 既存のダメージ選択と署名済みトークンを使う。辞退時は従来どおり非公開の手札へ。発動時のみ、ライフ最上段の同一個体を公開し、解決専用の内部スロットへ移す。
2. 既存の効果登場ワークを使用する。発動元の個体ID・世代・解決領域・カード種類・所有者・操作者を検証し、本人の場にアクティブで登場させる。印刷DONコストは支払わない。
3. キャラが5枚いる場合、発動者が場の1枚を選ぶ。ステージが埋まっている場合も同じ選択UIで既存の1枚を確認する。場のカードはルール処理として直接トラッシュに移す（KOではない）。既存の移動トランザクションを使い、枠を空ける移動と自己登場を両方検証してからまとめて公開する。無効な選択や世代不一致は適用しない。
4. 登場した個体は新しい世代で追跡し、トリガー終了時のトラッシュ送りを適用しない。発動して場に移っていないカードには既存のトリガー後片付けを維持する。不正状態（例：世代上限で移動不能）は既存の安全停止とし、先に場のカードをトラッシュへ移すこともない。
5. 新しい登場の移動イベントから既存の `ON_PLAY` 候補を作る。ダブルアタックでは次のダメージを処理できるように候補を保持し、ダメージ処理完了後に既存のキューへ戻す。場を離れた候補やゲーム終了後の候補は出さない。

[公式総合ルール §3-7、§3-8、§8-6-2、§10-1-5](https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20251017=)、[公式Q&A 全般 Q10・Q19・Q21](https://onepiece-cardgame.com/pdf/qa_rule.pdf)。登場禁止など今回モデル化していないカード固有の効果や裁定は、新たな挙動を推測しない。

## 生成・再集計

括弧の2表記（`【トリガー】`／`〖トリガー〗`）を許容し、トリガー欄全体が「このカードを登場させる。」のみの場合に変換した。56番号はキャラ49・ステージ7。キャラ17番号が完全生成、キャラ31・ステージ7番号が部分生成、キャラ1番号が印刷情報の未判定。ステージ7番号はトリガーのみ対応し、他の本文は保留。例：EB01-030。既存PR21の完全生成418件は定義hashまで一致した。

| 指標 | PR21 | PR23 |
| --- | ---: | ---: |
| 全番号 | 2,885 | 2,885 |
| 完全生成・Compiler成功 | 418 | 435 |
| うち効果なし | 291 | 291 |
| 部分生成 | 459 | 487 |
| 生成不能 | 1,848 | 1,802 |
| 生成側の未判定 | 160 | 161 |
| 未解釈箇所 | 3,490 | 3,434 |
| PR18の対応候補 | 405 | 422 |
| 承認 | 14 | 14 |

未判定の増加はOP03-116。トリガー本文を読み切れても、全6表示IDのパワー欄が `-` のため保留した。PR22方式のRuntime不足は218箇所／202番号から162箇所／147番号へ、自己登場は130箇所／123番号から74箇所／67番号へ減少。後者は条件・支払い付きの残件。Compiler成功はカードの意味レビュー・承認ではない。

```powershell
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed local-data/v3-review-ledger-pr00-20261029/source.csv local-data/v3-drafts-pr23-next --ledger local-data/v3-review-ledger-pr00-20261029/review-ledger.json
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-pr21-report local-data/v3-drafts-pr23-next local-data/v3-drafts-pr23-next-diff
node tools/analyze-v3-draft-blockers.js local-data/v3-review-ledger-pr00-20261029/source.csv local-data/v3-drafts-pr21-report/generation.json local-data/v3-drafts-pr23-next/generation.json local-data/v3-drafts-pr23-next-blockers
```

実行済み出力は `local-data/v3-drafts-pr23-report/`、`local-data/v3-drafts-pr23-vs-pr21/`、`local-data/v3-pr23-blockers/`。いずれもGit管理外。

## 互換性・検証・変更ファイル

- Compiler `v3-subset-compiler.45.1`、Registry `51aede513907ed81439477ca59f2410e2931c38f6288713439e744aef671274f`。旧subset.44のRegistry `731fa079caef72803c33c5221aa0d423c61196b3752102408985cd6c2510e852` および既存承認14枚は変更なし。通常対戦・一人回し・元CSV・承認カタログは変更なし。
- 関連60件、全回帰981件成功（失敗・スキップ0）。フロント・サーバービルドとSchemaの再生成差分チェックも成功。自己登場・登場時効果・複数ダメージ、満枠、古い参照、秘匿、再送、辞退、移動失敗時の原子性を確認。変更21ファイル（生成Schema・Registry一覧を除く19ファイル、+513/-69行）。実カードの新規承認なし。
- 保留：条件付き・支払い付き自己登場、他カード／複数カードの登場、他カードの領域条件付き `ON_EVENT` に対する内部スロットの意味づけ、未確定裁定。

| 区分 | ファイル |
| --- | --- |
| 隔離v3の実行と型 | `server/src/test/effects/v3/{compiler,conditionalTriggers,dsl,fixtureCoordinator,matchCoordinator,replacementPlans,resolution}.ts` |
| 生成・比較・監査 | `tools/{generate-v3-drafts,analyze-v3-coverage,analyze-v3-draft-gaps,analyze-v3-draft-blockers}.js` |
| Schema・Registry資料 | `tools/build-v3-trigger-play-schema.js`、`tools/build-v3-trigger-play-inventory.cjs`、`schemas/effect-v3-subset45.schema.json`、`docs/card-effect-supported-operations.json`、`docs/validate-card-effect-json.cjs` |
| テスト | `server/test/v3-trigger-play.cjs`、`tools/{test-v3-trigger-play-schema,test-v3-drafts,test-v3-draft-blockers}.test.js` |
| 報告 | `docs/card-effect-pr23.md` |
