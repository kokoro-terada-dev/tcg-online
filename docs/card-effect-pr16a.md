# PR16a: 攻撃先変更とバニッシュ

## DSL・発動範囲

- `RETARGET_BATTLE`: `{ "type": "RETARGET_BATTLE", "cards": { "ref": "bindings.defenderTarget" } }`。既存の `SELECT` 等で用意した最大1個体のカード集合を使う。空集合は何もしない。防御側リーダー・キャラクターの `ON_OPPONENT_ATTACK`（アタックステップ）と、防御側イベントの `COUNTER`（カウンターステップ）に限定する。
- `BANISH`: `{ "type": "BANISH" }` を印刷キーワードまたは `GRANT_KEYWORD` の `keyword` に指定する。`HAS_ABILITY` は `PRINTED_KEYWORD` と `CURRENT_KEYWORD` を区別する。
- `.42` のイベント `COUNTER` は、既存の `DON_RETURN` を最大1ノードまで発動コストとして指定できる。使用時の印刷コストは先にアクティブDON!!をレストして支払い、必要な場合はそのDON!!も発動コストの返却候補になり得る。サーバーが使用可能性を再検査し、返却候補と決定は既存の支払い・選択処理に委ねる。

## 処理順序と安全性

1. 攻撃宣言後の誘発またはカウンターイベントを既存の手順で解決し、既存の選択機構で対象を取得する。個体・世代・戦闘ステップ・効果フレーム・操作者と防御側を適用直前に確認する。場を離れた参照、相手側、非公開、耐性対象、UNKNOWNは適用しない。
2. 戦闘の攻撃対象だけを変更する。攻撃元、既に宣言されたブロッカー、直前の対象、変更効果の発生源・効果ID・操作者は区別する。再攻撃・追加のブロック・架空の領域移動は発行しない。アタックステップからは元のブロックステップへ進み、カウンターステップでは同じ窓に戻る。カウンターによるパワーは付与先の個体・世代に残る。
3. 最終対象でパワーを比較する。実際にリーダーへ戦闘ダメージが通る時のみ攻撃元の現在のバニッシュを確認する。ライフがあれば最上段1枚を既存の移動処理で表向きのトラッシュに移動し、ライフ選択やトリガーの機会は生成しない。原因は効果KOでなくルールの `DAMAGE`。ライフ0の敗北判定は従来どおり。
4. 攻撃先変更は既存Coordinatorの署名済みworkとrevision・再送管理を通す。選択待機中は既存の操作ロックを維持し、相手に未公開の選択候補やトークンを送らない。追加の解決器は作成していない。

根拠: [総合ルール 2-7-3、7-1、8-4、10-1-3](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)、[EB01-038公式Q&A](https://en.onepiece-cardgame.com/pdf/qa_eb01.pdf?20240419=)（アクティブのキャラへ変更可能。カウンター中の変更後にブロックをやり直さない）、[OP16公式Q&A Q1373](https://www.onepiece-cardgame.com/rules/qa.php?series=%E3%83%96%E3%83%BC%E3%82%B9%E3%82%BF%E3%83%BC%E3%83%91%E3%83%83%E3%82%AF+%E5%8F%97%E3%81%91%E7%B6%99%E3%81%8C%E3%82%8C%E3%82%8B%E6%84%8F%E5%BF%97%E3%80%90OP-16%E3%80%91&tab=cardqa&type=1)（キャラからリーダーへの攻撃先変更事例）。

## 互換性と保留

- Schema `3.0.0-subset.42`（SHA-256 `c7c3f0f027cf560fe428668f7ffa6ebcfbe7b2a2682dbcd1ce7fdf01b01a26b0`）、Compiler `v3-subset-compiler.42.1`、Registry SHA-256 `b7a432d80d72531e86663615ecec063bfcb76f8345beeb96d0ae273a6d33541f`。`.41` 以下、承認manifest、通常対戦・一人回しは変更しない。
- EB01-038・OP16-080・OP06-101は部分要件を合成fixtureで検証。各カードの他の効果や版差異を省略して承認していない。戦闘参加者が離れた後の変更、他のタイミング、汎用ダメージポリシー、複数・多段ダメージ、ステージKO、追加ターンは未対応。

## 検証と変更ファイル

- 関連5件成功。全回帰は一括936件成功（失敗・スキップ0）。サーバービルド成功。フロントは隔離対戦のworkラベル2箇所を補い、再ビルド成功。
- 集計: 28ファイル（新規7、既存21）、全体+9938/-126行、生成物を除き+481/-52行、実行ソース+146/-51行。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・共通Runtime | `server/src/test/effects/v3/dsl.ts`、`compiler.ts`、`resolution.ts`、`readContext.ts`、`keywordEffects.ts`、`replacementPlans.ts` |
| 戦闘・Coordinator | `server/src/test/effects/v3/battle.ts`、`counterEvents.ts`、`conditionalTriggers.ts`、`matchCoordinator.ts`、`fixtureCoordinator.ts`、`fixtureProtocol.ts` |
| 戦闘状態 | `server/src/test/progression/state.ts`、`transitions.ts`、`types.ts` |
| 隔離対戦UI | `src/testMatch/V3FixtureLobby.tsx`、`src/testMatch/V3SessionPanel.tsx` |
| テスト | `server/test/v3-battle-effects.cjs`、`tools/test-v3-battle-effects-schema.test.js` |
| 生成・検証 | `tools/build-v3-battle-effects-schema.js`、`tools/build-v3-battle-effects-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset42.schema.json`、`docs/card-effect-battle-effects.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr16a.md` |
