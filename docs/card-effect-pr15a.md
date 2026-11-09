# PR15a: 同一イベントのMAIN本文をライフTRIGGERから実行

## 対応範囲

- `CALL_EFFECT_BODY` はイベントカードのライフ `TRIGGER` の唯一のルートアクションとして使える。`effectId` は同じ承認済みカード定義にある `MAIN` のIDを指定する。カード番号や外部カタログは参照しない。
- 例: TRIGGERの `actions` を `[{"type":"CALL_EFFECT_BODY","effectId":"main"}]` とし、MAINの `main` に現在パワー6000以下の相手キャラを0〜1枚選ぶ `SELECT` と `KO` を置く。ST01-015と同じ選択範囲を合成fixtureで検証した。[公式ST01 Q&A](https://www.onepiece-cardgame.com/pdf/qa_st-01-st-04.pdf?v220801=)
- [公式総合ルール](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)の8-5、8-6-2-1、10-1-5-3、10-2-3-1-1に沿い、手札からイベントカードをプレイすることと効果の呼び出しを区別する。TRIGGERはメインフェイズへの移行、手札からの移動、印刷コストの支払いを行わない。本文の `OFFER_PAYMENT`、条件分岐、対象選択は元の命令どおり処理する。
- 呼び出し先は既存の対話型イベントMAINの対応範囲に限定する。独立した発動条件・解決条件、追加の発動コスト、使用回数制限、任意発動を持つMAINは推測で扱わず拒否する。本文の分岐や任意支払いとは区別する。

## 解決・安全性

1. Compilerは参照先が同一定義内の対応MAINか確認する。TRIGGER以外、ネスト、複数呼び出し、別カード、MAIN以外、自己参照、循環を拒否する。承認ハッシュは呼び出し元・先を含む定義全体を固定する。
2. 承認済み定義から、共通Runtimeの既存命令列へMAINの本文だけを1回展開する。元のTRIGGERの操作者・発生源カードの個体／世代・ライフ由来の解決IDを保持し、呼び出し先IDは別に保持する。
3. 本文の候補選択・支払いを既存の署名付きフレームで待機し、revision・token・選択権限・再送を検証する。呼び出し先の命令列を再現して同じ位置から再開する。
4. 本文が発生させた移動・KOは、元カードを発生源として既存誘発キューへ渡し、観測記録にはMAINの効果IDを記録する。処理後のトラッシュ移動は元TRIGGERの後処理として1回だけ行う。対象が0枚でも後処理は行う。

## 互換性・保留

- Schema `3.0.0-subset.40`、Compiler `v3-subset-compiler.40.1`、Registry SHA-256 `c3014d8b02675feaf6ab72484d1a6ff6f19f6391f3a249489f3f1fcc079b8c4c`。生成Schema SHA-256（LF）: `15e80a6578279e7c18e47ae83e80288389d034fb1ff581810a045dedc258d6ae`。
- 旧ハッシュと既存14枚の承認manifestはそのまま。通常対戦・一人回しは変更なし。実カードの新規承認なし。他カード呼び出し・共有使用回数はPR15bに残す。

## 検証と変更ファイル

- 関連26件成功。全回帰は一括925件成功（失敗・スキップ0、個別再実行なし）。フロント・サーバービルド成功。
- PR14c異常: 既存記録では `local-effects.cjs` のNode子プロセスが `0xC0000409` で終了し、単体の再実行は5件成功。該当テストは一時ポートのローカルSocketを使用する。Windows Applicationログの直近の異常終了記録とNodeダンプの有無を確認したが、原因を示す記録は見つからず、未特定。今回の全回帰は並列度2で再現せず。テストの除外・弱体化なし。
- 集計: 18ファイル（新規7、既存11）、全体+9178/-103行、生成物を除き+371/-31行、実行ソース+67/-30行。既存のRuntimeとライフTRIGGERの後処理を再利用し、独立した解決器は追加していない。

| 区分 | 変更ファイル |
| --- | --- |
| DSL・Runtime | `server/src/test/effects/v3/compiler.ts`、`dsl.ts`、`resolution.ts`、`replacementPlans.ts` |
| Coordinator・誘発 | `server/src/test/effects/v3/fixtureCoordinator.ts`、`matchCoordinator.ts`、`conditionalTriggers.ts` |
| テスト | `server/test/v3-effect-body.cjs`、`tools/test-v3-effect-body-schema.test.js` |
| 生成・検証 | `tools/build-v3-effect-body-schema.js`、`tools/build-v3-effect-body-inventory.cjs`、`docs/validate-card-effect-json.cjs` |
| 生成物 | `schemas/effect-v3-subset40.schema.json`、`docs/card-effect-body.schema.json`、`docs/card-effect-supported-operations.json`、`docs/card-effect-types.ts.txt` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr15a.md` |
