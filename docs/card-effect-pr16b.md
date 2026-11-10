# PR16b: ステージKO・ライフ移動・ダブルアタック

## DSL

| 命令 | JSON例 | 適用範囲 |
| --- | --- | --- |
| `KO_STAGE` | `{"type":"KO_STAGE","cards":{"ref":"bindings.stage"}}` | 現在の公開ステージ個体のみ。従来の `KO` はキャラ専用、戦闘KOもキャラ専用。 |
| `MOVE_LIFE` | `{"type":"MOVE_LIFE","player":"SELF","from":"DECK_TOP","to":"LIFE_TOP","faceUp":false}` | `DECK_TOP` または `BOUND` からライフの上・下へ1枚。表裏を明示する。 |
| `MOVE_LIFE` | `{"type":"MOVE_LIFE","player":"OPPONENT","from":"LIFE_BOTTOM","to":"HAND"}` | ライフの上・下から同じ所有者の手札・トラッシュ・デッキ下へ1枚。 |
| `DOUBLE_ATTACK` | `{"type":"DOUBLE_ATTACK"}` | 印刷キーワードまたは `GRANT_KEYWORD`。リーダーへの戦闘ダメージを1点ずつ最大2点解決する。 |

- `MOVE_LIFE` の `player` は `SELF` / `OPPONENT`。 `BOUND` では最大1枚の `cards` を指定し、公開カードまたは効果操作者自身が閲覧を許可された手札・確認済みデッキのカードのみ扱う。対象0枚なら移動しない。効果文の任意選択は既存の選択・モードで表現する。
- 移動確定時に個体・世代・領域・所有者・操作者・先頭/末尾を再検証する。`MOVE_RESULT` は `MOVE_LIFE` の前後の世代・領域・原因と各時点の閲覧権限を引き継ぐ。裏向きのライフの識別子・カード情報は相手に送らない。トラッシュに入れば公開するが、効果移動なのでライフトリガーは発生しない。
- ステージは種別を維持してトラッシュに移り、移動イベントは `EFFECT_KO`。耐性と既存移動ルールを通し、公開ステージを指定した `.43` の `CARD_KO` 監視だけがステージKOに反応できる。既存のキャラ用 `ON_KO` は変えていない。

## ダメージの処理順序

1. カウンター終了後、通常どおり攻防のパワーを比較する。リーダーへのヒット時に攻撃元のダブルアタックとバニッシュを読み、該当する場合に残り1点を戦闘に記録する。UNKNOWNは推測しない。
2. 1点目の最上段ライフを確認する。手札に加えるか、既存のライフトリガーを最後まで解決する。バニッシュならライフを公開トラッシュへ送り、トリガーを開かない。移動に伴う既存の誘発解決が終わるまでは次のダメージを開始できない。
3. ライフが残っていれば、防御側が「残りのダメージを解決」を押して2点目に進む。攻撃元が離れていてもパワーやダメージ枚数を再計算しない。1点目と異なる選択IDを発行し、古い選択トークンや古いrevisionは拒否する。再送は既存のリクエスト履歴で二重適用しない。
4. ライフがある状態から始まった攻撃は、ライフ不足で2点目が余ってもその攻撃では勝利しない。最初のヒット確定時からライフ0なら従来どおり勝利する。

根拠: [公式総合ルール 7-1-4・10-1-2・10-1-3](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)、[公式基本ルールQ&A 18〜20・24](https://www.onepiece-cardgame.com/pdf/qa_rule.pdf)、[公式OP-17カードリスト（OP17-116）](https://www.onepiece-cardgame.com/cardlist/?series=550117)。

## 互換性・未対応

- Schema `3.0.0-subset.43`（SHA-256 `2e6105bdb2b3b084df72297d867aa52a02470493b81ed39bc2a7580f2c45eef7`）、Compiler `v3-subset-compiler.43.1`、Registry SHA-256 `f3e6bca8fde644d4d7a6f4b61fe5b4c5f2c0c6e3a73d630d4ed6fee763aa90f7`。旧プロファイル・既存14枚の承認manifestは変更なし。通常対戦・一人回しは変更なし。
- OP17-116は【メイン】の印刷コスト1、追加支払い2、ステージKOを合成fixtureで検証。実カード全体は承認していない。任意のダメージ量を直接発生させるDSL、非公開ライフの任意位置選択・並べ替え、ステージ固有の自己KO誘発は今回公開しない。追加ターン（PR16c）は未着手。

## 検証と変更ファイル

- 関連10件成功。全回帰は一括943件成功（失敗・スキップ0）。フロント・サーバービルドは各1回成功。
- 集計: 30ファイル（新規7、既存23）、全体+10381/-150行、生成物を除き+582/-74行、実行ソース+190/-73行。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/dsl.ts`、`compiler.ts`、`resolution.ts`、`readContext.ts`、`keywordEffects.ts`、`simpleMainEvent.ts`、`replacementPlans.ts` |
| 戦闘・Coordinator・誘発 | `server/src/test/effects/v3/battle.ts`、`fixtureCoordinator.ts`、`fixtureEnvironment.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts`、`conditionalTriggers.ts` |
| 移動・戦闘状態 | `server/src/test/movement/engine.ts`、`server/src/test/progression/state.ts`、`transitions.ts`、`types.ts` |
| 隔離対戦UI | `src/testMatch/V3FixtureLobby.tsx`、`src/testMatch/V3SessionPanel.tsx` |
| テスト | `server/test/v3-damage.cjs`、`tools/test-v3-damage-schema.test.js` |
| 生成・検証 | `tools/build-v3-damage-schema.js`、`tools/build-v3-damage-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset43.schema.json`、`docs/card-effect-damage.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr16b.md` |
