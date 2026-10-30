# PR07b 適用済み効果の境界期限

基準: `d5f5222`。PR07bのみ。PR08以降と、PR12の継続効果処理は実装していません。

## 対応範囲と版

新Schema `3.0.0-subset.24` / Compiler `v3-subset-compiler.24.1`。
Duration Registryへ`UNTIL_BOUNDARY@1`を追加。全体50登録。
Registry hash: `3780ed0fdeb5c26d43c2f7093e3d767933bfe305094290646fd5943d5cc54af1`。
旧16〜23のCompiler/Schema/Registry hash、既存14枚のdefinition/source/approval manifestは変更していません。

対象は、既存のMODIFY_STATによるpower/costの増減とGRANT_KEYWORDによる付与です。
既存のStatEffects/KeywordGrants、共通Runtimeのwork、PR07aのフェイズ継続を拡張し、別の解決器・時計・イベントバスは作っていません。
TURN_END/BATTLE_ENDの既存の期限表現・意味・旧構成の進行経路は維持します。
既存のイベントMAIN用プログラム制約等を一律に緩和していません。新Durationだけを追加して未対応プログラム全体を実行可能にはしません。

## DSLの正式な指定

```json
{
  "type": "UNTIL_BOUNDARY",
  "player": "OPPONENT",
  "boundary": "END_PHASE_END",
  "occurrence": 1,
  "includeCurrent": false
}
```

全パラメータ必須。playerは効果操作者に対するSELF/OPPONENT、boundaryはTURN_START/END_PHASE_END、occurrenceは1/2、includeCurrentはboolean。
例はカードの自然文を自動変換する規則ではありません。原文からこれらの値を選ぶ意味レビュー・承認は別途必要です。

| boundary | 実際の失効箇所 |
| --- | --- |
| TURN_START | 対象プレイヤーのリフレッシュフェイズ入口。通常のDON返却・アクティブ化・ドローより前 |
| END_PHASE_END | 対象ターンの終了時誘発とその派生処理が完了した後、次ターンへ進む前 |

**includeCurrentの機械的定義:** END_PHASE_ENDで対象playerが適用時のターンプレイヤーなら、trueはそのターン末を1回目に含め、falseはその同一ターン末を飛ばします。
対象が非ターンプレイヤーなら、次にそのプレイヤーへ来る通常ターン末が1回目。
TURN_STARTは既に過ぎた現在ターン開始を含めず、常に次の対象プレイヤーの開始から数えます。
occurrence=2は対象プレイヤーの同じ種類の境界をさらに1回待ちます。通常交互ターン以外をこの数式で推測しません。

適用時がターン1/player0の場合:

| 指定 | 失効ターン |
| --- | --- |
| SELF / TURN_START / 1 | 3 |
| OPPONENT / TURN_START / 1 | 2 |
| SELF / END_PHASE_END / 1 / true | 1 |
| SELF / END_PHASE_END / 1 / false | 3 |
| OPPONENT / END_PHASE_END / 1 | 2 |
| OPPONENT / END_PHASE_END / 2 | 4 |

「次の相手のエンドフェイズ終了時まで」等をこの構造で表現できますが、対戦中のどの文言・場面でincludeCurrentを選ぶべきか未確認ならカード定義を保留します。
EB05-007等も期限部分の表現ができるだけで、公開コスト等の未対応部分を省略してカード全体を承認していません。

## 発生・適用・失効の区別

- 発生条件はPR06a/bのEventContext/候補台帳に保存され、発生時snapshotを解決時に書き換えません。
- 新期限は**MODIFY_STAT/GRANT_KEYWORDのwork適用時**に、認可済みCoordinatorの現在盤面・Progressionから作ります。
- AnchorはmatchId、turnNumber、activePlayer、phase、phaseToken、movementRevision、通常交互ターンという契約を保持。
- 操作者に対するSELF/OPPONENTを絶対playerへ変換し、適用時点で失効ターンを確定。表示回数・リフレッシュ回数・実時間タイマーでは管理しません。
- 効果の対象は個体ID/世代で固定。対象が領域移動したら既存pruneを使い、新世代へ同じ修正を付け替えません。
- 新期限の台帳はendPlayer/remainingをnullとし、明示boundaryとanchorを保持。旧remainingカウンタへ混ぜません。
- 失効先とanchorの整合性を検証し、不明なアンカー/値を0やfalseに置き換えません。適用できなければ既存work拒否/blockedを維持します。

## 境界・順序・再開

TURN_STARTの失効は公式総合ルール6-2-1、END_PHASE_ENDの配置は6-6-1-1〜1-4の区別を参照しました。
[公式総合ルール ver.1.2.1（2026-08-28）](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240419=)
期限のTURN_STARTを追加したのであって、未対応の一般的なTURN_START誘発Timingを追加したわけではありません。

1. 終了時候補・選択・work・派生候補が残っている間、END_PHASE_ENDへ進めません。修正はその間有効。
2. 終了時処理がすべて終わった時点で、同じ認可済みcheckpointからstat/keywordをまとめて失効。既存のTURN_END後始末へ進みます。
3. 次のrefresh入口でTURN_START期限を失効してから通常フェイズを進めます。MAIN_START条件の評価では既に失効した値になります。
4. phaseToken/境界種別の処理済み記録を同じdraftに保持。再開・再送でも失効や旧remaining減算を重ねません。

新期限を使う定義がある試合では、境界誘発がなくても既存phase continuation経路で時計を処理します。
物理的なDON/ドロー処理は既存共通helperのままです。新期限のない旧構成を別の進行経路へ切り替えません。

## 安全性

- 新期限のcheckpointはサーバー内で現在のProgressionから作り、brandを検査。フィールドをコピーした偽checkpointは拒否。
- 通常交互ターンのfirstPlayer/activePlayer/turnNumberを確認。追加ターン/スキップ用の新命令はなく、矛盾した順序や処理されなかった過去期限を安全に拒否します。
- 絶対ターン指定なので同じcheckpointを重ねても余分に期限が進みません。境界記録は1024件上限。
- stat/keywordの失効とphase・記録は共通draftから成功後だけ確定し、片方だけ失効した途中状態を公開しません。
- 適用時は既存と同じwork単位の確定です。SEQUENCE全体の一括巻戻しを新たに保証したものではありません。
- work/requestId/revision/HMAC/選択者/対象の検査を維持し、再送で効果が重複したり適用アンカーが新しくなったりしません。
- 選択待機中は新しい期限効果を未適用のまま保持。別のMAIN・ターン移行は既存ロックで拒否。
- Anchor・失効記録・非公開選択肢はSocket DTOへ送りません。両者には既存の公開power/cost/keyword結果だけを同期します。
- 通常対戦・一人回し・通常ルーム・カード番号別ロジックは変更していません。

## 検証

**379件成功、失敗0、skip0**。既存360件と新規19件（核13、両座席/2期限のSocket4、Schema/命令表2）。
自他/両座席、同じターンを含む/除外、2回目、END処理中適用、開始失効とMAIN条件の順、cost修正とkeyword、選択待ち、work/境界再送、対象世代変更、偽proof、古いcheckpoint、未処理期限、未対応ターン順を検証しました。
旧TURN_END/BATTLE_END・既存14枚・PR05b/06/07aと旧hashの回帰、サーバーbuild、フロントbuild成功。
フロントは既存500KiB超チャンク警告のみ。Schema生成物の再現と旧23での拒否を確認しました。
Ajv 8は既存の外部検証ディレクトリをNODE_PATHで利用。依存/lockfileは変更していません。iPhone実機目視は未実施です。

```powershell
npm --prefix server run build
node --test server/test/v3-boundary-expiry.cjs
node tools/build-v3-expiry-schema.js --check
npm run build
```

## 確認用画面

今回のローカルURLは http://127.0.0.1:5196/ 。旧5190等のバックエンドは今回の検証モードを持ちません。
テスト対戦・合成モードでデッキ選択/READY後、「期限：開始・エンド終了」を選択して開始します。
リーダーMAINの「次の自分ターン開始まで+1000」「次の相手エンド終了まで+1000」で合成power/keywordを適用し、両端末で失効を確認できます。実カードの能力ではありません。

## 保留・非対象

PR12の継続効果/条件変動による再計算、場にいる間等の新Duration、自然文の自動期限変換、未確定裁定、追加/スキップターン、一般TURN_START誘発、新カード承認、管理者復旧・サーバー再起動をまたぐ試合全体の復旧は未対応です。
適用済み台帳の検証やframeの中断再開を、試合全体のDB永続化と呼びません。PR08以降には進んでいません。

## 変更規模・一覧

24ファイル（新規7・既存17）、追加5871行・削除96行。生成Schema2ファイル（5180行）を除くと追加691行・削除96行。実行ソースのみは追加133行・削除40行です。
期限の共通契約をeffectExpiryに集約し、旧stat/keyword台帳と既存Runtime・phase helperを利用。独立した効果解決器や無関係な大規模改変はありません。
全ファイル一覧は`local-data/v3-pr07b-changed-files-20261030.md`、変更ファイルだけのZIPは`local-data/v3-pr07b-20261030.zip`へ出力します（git管理外）。
