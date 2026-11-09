# PR14c: 置換元の優先順位とターン1回制限

## 対応範囲

- 隔離v3の単一の効果KOを対象とする。対象自身の置換に加え、自分の公開キャラを保護する公開リーダー・キャラ・ステージを、発生元の個体と世代で区別する。別個体の同じカード番号・同じrule IDも別の候補になる。
- `REPLACE_EVENT@3` の `target: {"type":"OWN_CHARACTER","minPrintedCost":4}` は、対象の**印刷コスト**を使う。指定なしは従来どおり自身のみ。外部のキャラを守る場合は手札1枚破棄のみ。自身の効果KOは `optionalPayment: {"type":"DON_RETURN","count":1,"from":["activeDon","restDon","attachedDon"]}` も利用できる。
- `usageLimit: "ONCE_PER_TURN"` は置換元の個体・世代・rule ID・ターン単位。発動効果とは別台帳で、支払いを含む置換の確定時にだけ消費する。同じターンの別の効果解決にも引き継ぎ、次のターン番号に切り替わった時点で解放する。
- [公式総合ルール 8-1-3-4](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)に従い、元処理の発生元、ターンプレイヤー、非ターンプレイヤーの順に候補群を作る。本実装の外部候補は保護対象と同じ側に限定される。同順位では操作者が選択し、その群をすべて辞退した場合にだけ次の候補群を提示する。

## 選択・確定

1. 元の移動意図と耐性をPR14a/bと同じ経路で検査する。選択を待つ間は盤面、支払い、使用回数を変更しない。各群のtokenは再発行し、相手には候補や支払い可否を投影しない。
2. 再開時に元の意図・選択した発生元・対象・世代・使用状況・支払い可否を照合する。UNKNOWNや競合を推測で補わない。すべて辞退した場合は従来どおり元の処理だけを行う。
3. 承認した場合は元のKOを実行せず、PR10の支払い検証を通した代替移動だけを既存MovementStoreで確定する。代替の原因は置換元のカード・rule IDに帰属させ、実際の移動だけが誘発対象になる。再送は既存の受付記録で重複適用を防止する。
4. 元の意図、代替操作と原因、適用ID、使用キーはサーバー内に保持する。誘発検証で確定が失敗した場合は破棄・DON返却・使用回数のいずれも公開しない。

## 互換性・保留

- Schema `3.0.0-subset.39`、Compiler `v3-subset-compiler.39.1`、Registry SHA-256 `e3d6b515bc5ffed5ba7a12fbf04470918697c8d055888285d2c1f2472bdd42c3`。生成Schema SHA-256（LF）: `68eee6021bd7ff9e5cf2cb8c6385c94c781669de65300a93603feba4b77e1bf3`。
- 旧Schema・Compiler・Registry hashと既存14枚の承認manifestはそのまま。通常対戦・一人回しは変更なし。EB01-008・EB03-001・EB04-030の対応部分は合成fixtureで検証し、実カードは新規承認していない。
- 同時KOの配分、連鎖置換、戦闘KO・ルール由来の置換、相手側のカードを対象とする外部置換、複合支払いは対象外。EB02-030のような、解決時点にいた個体へ戦闘置換を付与する処理も保留する。[公式EB02 Q&A](https://en.onepiece-cardgame.com/pdf/qa_eb02.pdf?20250425=)
- サーバー再起動をまたぐ永続化は未対応。PR15以降には進んでいない。

## 検証と変更ファイル

- 関連18件、回帰920件を確認。一括実行では915件成功したが、`local-effects.cjs` のNodeプロセスが終了コード `0xC0000409` で異常終了した。同ファイルの再実行は5件すべて成功。スキップなし。フロント・サーバービルド成功。
- 集計: 21ファイル（新規7、既存14）、全体+9143/-146行、生成物を除き+462/-73行、実行ソース+176/-72行。PR14a/bの意図、署名付きフレーム、コスト検証、移動・誘発の確定経路を拡張し、独立した解決器は追加していない。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`replacementPlans.ts` |
| Coordinator・通信 | `server/src/test/effects/v3/fixtureCoordinator.ts`、`fixtureProtocol.ts`、`matchCoordinator.ts`、`conditionalTriggers.ts` |
| 隔離対戦UI | `src/testMatch/V3ChoicePanel.tsx`、`V3SessionPanel.tsx` |
| テスト | `server/test/v3-replacement-priority.cjs`、`tools/test-v3-replacement-priority-schema.test.js` |
| 生成・検証 | `tools/build-v3-replacement-priority-schema.js`、`tools/build-v3-replacement-priority-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset39.schema.json`、`docs/card-effect-replacement-priority.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr14c.md` |
