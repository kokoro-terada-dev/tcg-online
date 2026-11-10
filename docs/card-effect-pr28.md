# PR28: 条件付きライフトリガー自己登場

## ルールと実装

- [公式総合ルール](https://en.onepiece-cardgame.com/pdf/rule_comprehensive.pdf) の §8-3-3、§8-4-1-1、§8-6-2、§10-1-5 を参照。対象原文の「～の場合」は、発動前の制限ではなく後続処理の解決条件。トリガーを使用してライフからカードを除いた後の盤面で判定する。条件不成立なら登場せず、既存のトリガー終了処理でトラッシュへ。発動を辞退した場合は公開せず手札へ。満枠・ダメージ途中の誘発順序はPR23の既存仕様を維持する。
- `3.0.0-subset.48` では、キャラ／ステージのライフ `TRIGGER` 全体が単独の `PLAY_TRIGGER_SOURCE` である場合のみ、公開情報を読む `resolutionConditions` を許可する。発動コスト、発動前条件、先行・併記アクションは許可しない。印刷DON!!コストは支払わない。
- 既存 `compare` で自分・相手のライフ／手札／DON!!枚数を読み、`EXISTS + QUERY_CARDS` で公開リーダーの正確な名前・特徴を判定できる。`TURN_IS` と `all`／`any`／`not` も既存の評価器を使用。手札などの非公開カード検索やSOURCE依存の条件は禁止。公開リーダーの信頼できるメタデータが無い場合は `UNKNOWN` のまま既存の安全停止とする。
- PR23と同じ処理で発動元の個体ID・世代・解決領域・所有者・操作者を検証する。満枠選択中は盤面がロックされ、revisionが変化した応答は拒否する。登場後は既存 `ON_PLAY` キューを使い、ダメージ処理が終わってから解決する。

効果定義の該当部分：

```json
{
  "activationConditions": { "type": "all", "conditions": [] },
  "resolutionConditions": {
    "type": "compare",
    "left": { "ref": "SELF.lifeCount" },
    "op": "lte",
    "right": 2
  },
  "costs": [],
  "actions": [{ "type": "PLAY_TRIGGER_SOURCE" }]
}
```

Schema `3.0.0-subset.48`、Compiler `v3-subset-compiler.48.1`、変更ハンドラー `PLAY_TRIGGER_SOURCE@2`。Registry SHA-256: `9e107c1ddf940321cce427a0bb0b3267a8d57d34e088df6e7317caab8d73de01`。旧プロファイル、既存14枚の承認、元CSV、通常対戦・一人回しの変更なし。新規承認0枚。

## 76番号の再分類と生成結果

PR26の83箇所をPR27/28の同じ版ハッシュ・原文位置と照合。PR27ですでに解消したものは0。無条件0番号、追加支払いなしの条件付き42番号・48箇所、追加支払い付き31番号・32箇所、先行処理を含むため別途確認するもの3番号・3箇所。これはこの76番号だけの内訳であり、PR23の無条件56番号は別集計。

| 新規生成パターン | 番号 | 箇所 | うち完全生成 |
| --- | ---: | ---: | ---: |
| 自分／相手のライフ枚数 | 13 | 19 | 1 |
| リーダーの名前の完全一致 | 11 | 11 | 5 |
| リーダーの特徴の完全一致 | 8 | 8 | 2 |
| リーダーの特徴とライフ枚数の両方 | 2 | 2 | 2 |
| 計 | 34 | 40 | 10 |

代表照合: `OP16-111` は自分の残りライフ、`OP06-100` は相手のライフ、`OP03-033` はリーダーの特徴を参照。`EB02-055` は魚人族または人魚族と自分のライフ条件、`ST28-003` はワノ国と相手のライフ条件を両方保持する。DON!!枚数条件は合成fixtureで検証し、この76番号での該当は0。

| 指標（全2,885番号） | PR27 | PR28 |
| --- | ---: | ---: |
| 完全生成・Compiler成功 | 470 | 480 |
| うち効果なし | 291 | 291 |
| 部分生成 | 516 | 530 |
| 生成不能 | 1,735 | 1,711 |
| 未判定 | 164 | 164 |
| 未解釈箇所 | 3,315 | 3,275 |
| 対応候補 | 457 | 467 |
| 承認済み | 14 | 14 |

PR27の完全生成470件は全件、状態・定義ハッシュとも一致。新しいsubset.48の10定義はCompilerとJSON Schemaの両方に適合。DSL案の検証成功はカードの承認ではない。保留は42番号・43箇所（追加支払い31番号、ライフ合計／多色など8番号、先行処理3番号）。

## 再実行と検証

```powershell
npm --prefix server run build
node tools/build-v3-conditional-trigger-play-profile.cjs --check
$source = 'local-data/v3-review-ledger-pr00-20261029/source.csv'
$ledger = 'local-data/v3-review-ledger-pr00-20261029/review-ledger.json'
node tools/generate-v3-drafts.js server/data/effects-v3-reviewed $source local-data/v3-drafts-pr28-report --ledger $ledger
node tools/analyze-v3-draft-gaps.js local-data/v3-drafts-pr27-report local-data/v3-drafts-pr28-report local-data/v3-drafts-pr28-vs-pr27
node tools/analyze-v3-draft-details.js $source local-data/v3-drafts-pr27-report/generation.json local-data/v3-drafts-pr28-report/generation.json local-data/v3-pr28-report
node tools/analyze-v3-trigger-play.js local-data/v3-pr26-report/details.json local-data/v3-drafts-pr27-report/generation.json local-data/v3-drafts-pr28-report/generation.json local-data/v3-pr28-trigger-play
```

出力には未作成のディレクトリを指定。分類別の原文、版ハッシュ、表示ID、生成前後の状態は `v3-pr28-trigger-play/trigger-play.json`（Git管理外）に保存した。

関連38件、全回帰1,004件が成功（失敗・スキップ0）。フロント・サーバービルド、subset.47/.48の生成物照合も成功。条件成立／不成立、辞退、満枠、古いrevisionと再送、発動元以外の操作拒否、登場後の誘発とPR23の無条件処理を検証した。

## 変更ファイル

- 隔離v3: `server/src/test/effects/v3/{compiler,conditionalTriggers,dsl,fixtureCoordinator,matchCoordinator,replacementPlans,resolution}.ts`。
- 生成・分析: `tools/{analyze-v3-coverage,analyze-v3-draft-blockers,analyze-v3-draft-details,analyze-v3-draft-gaps,analyze-v3-trigger-play,generate-v3-drafts,v3-draft-diagnostics,v3-trigger-self-play}.js`。
- プロファイル生成・検証: `tools/build-v3-conditional-trigger-play-profile.cjs`、`tools/build-v3-field-don-profile.cjs`、`docs/validate-card-effect-json.cjs`。
- テスト: `server/test/v3-trigger-play.cjs`、`tools/{test-v3-draft-blockers,test-v3-draft-details,test-v3-drafts,test-v3-trigger-play-schema}.test.js`。
- 報告・生成物: `docs/card-effect-pr28.md`、`docs/card-effect-supported-operations.json`、`schemas/effect-v3-subset48.schema.json`。
