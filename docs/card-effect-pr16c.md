# PR16c: 追加ターンの予約と実行

## 対応範囲

- DSLは `{"type":"EXTRA_TURN"}`。キャラクターの `ON_PLAY` で、自分のメインフェイズに自分の効果として解決する場合に限り、現在のターン直後に自分の追加ターンを1回予約する。相手や回数を指定するパラメータはない。
- 既存の発動条件・コスト・選択の後、署名付きworkの適用時に発生元の個体・世代・領域・所有者・操作者、ターン番号と解決中のフレームを再検証する。選択待ちや辞退では予約しない。古いrevisionは拒否し、同じ要求の再送は二重に適用しない。カード移動や誘発イベントを捏造しない。
- 二重予約・追加ターン中の連鎖予約・相手ターン中の予約は保留。無効な予約を適用せず、既存の安全停止を使う。予約後に勝敗が決まった場合は予約を破棄し、次のターンへ進まない。

## 実行順序

1. 現在のターンのエンドフェイズを通常どおり進め、終了時誘発があれば解決する。対応する効果の期限を処理する。
2. 次のターンへ進む箇所で予約を1回だけ消費し、ターン番号を更新する。予約がある場合だけ手番を維持し、通常と同じリフレッシュ・ドロー・DON!!追加・メイン開始時誘発を処理する。追加ターンの終了後は相手のターンに移る。
3. 通算ターン番号に加え、予約発生後は各プレイヤーが実際に迎えたターン数を保持する。ターン1回の使用状態は新しいターンで更新し、相手の初回ターンの攻撃禁止は維持する。
4. `UNTIL_BOUNDARY` は対象プレイヤーの実際の開始・終了を数える。予約前の効果も引き継ぎ、自分の次ターンを指定した効果は追加ターンで、相手の次ターンを指定した効果は相手に手番が移ってから失効する。予約がない対戦では旧期限計算を維持する。

根拠: [公式OP-05カードリスト（OP05-119）](https://www.onepiece-cardgame.com/cardlist/?series=550105)、[公式総合ルール（6章: ゲームの進行）](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)。単一の追加ターンの範囲だけを実装し、複数予約の優先順などは確定扱いしていない。

## 互換性と未対応

- Schema `3.0.0-subset.44`（SHA-256 `59e917b4f9d35cbc597bbb10f909341767d7cf98050969d93f33d0f89caed2c8`）、Compiler `v3-subset-compiler.44.1`、Registry SHA-256 `731fa079caef72803c33c5221aa0d423c61196b3752102408985cd6c2510e852`。旧プロファイル・既存14枚の承認manifestは変更なし。通常対戦・一人回しは変更なし。
- OP05-119は追加ターンの部分要件のみを合成fixtureで検証。カード全体の認定や実カードの追加は行っていない。追加ターンの積み重ね、追加ターンからの連鎖、ターンやフェイズのスキップ、公式裁定未確定の進行変更は対象外。PR17には進んでいない。

## 検証と変更ファイル

- 関連18件成功。全回帰は一括948件成功（失敗・スキップ0）。サーバービルド成功。フロントは通信型を補って再ビルド成功。
- 集計: 26ファイル（新規7、既存19）、全体+10450/-146行、生成物を除き+444/-68行、実行ソース+137/-67行。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/dsl.ts`、`compiler.ts`、`resolution.ts`、`effectExpiry.ts`、`replacementPlans.ts` |
| Coordinator・誘発 | `server/src/test/effects/v3/fixtureCoordinator.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts`、`sessionProtocol.ts`、`conditionalTriggers.ts` |
| ターン進行 | `server/src/test/progression/state.ts`、`transitions.ts`、`types.ts` |
| 隔離対戦UI | `src/testMatch/V3FixtureLobby.tsx`、`src/testMatch/V3SessionPanel.tsx` |
| テスト | `server/test/v3-extra-turn.cjs`、`tools/test-v3-extra-turn-schema.test.js` |
| 生成・検証 | `tools/build-v3-extra-turn-schema.js`、`tools/build-v3-extra-turn-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset44.schema.json`、`docs/card-effect-extra-turn.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr16c.md` |
