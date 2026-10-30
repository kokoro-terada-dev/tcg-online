# PR05b: イベントMAINの選択待ちと再開

日付: 2026-10-30。基準: `f3bdb18`。隔離v3のみ。PR06以降は未実施です。

## 対応した範囲

新Schema `3.0.0-subset.20`で、既存の共通Runtimeに以下のイベントMAINを接続しました。

- SELECT: 公開leader/character/stage、または自分hand。CARDSのみ、DON・trash・deck・publicエリア・BOUND_CARDSは今回除外。
- IF、SEQUENCE、SELF DRAW、KO、REST、SET_ACTIVE、MOVE_CARD（hand/trash/publicへappend）、REVEAL、MODIFY_STAT/GRANT_KEYWORD（TURN_ENDのみ）。
- Predicateは既存の範囲ですが、SOURCEの値/メタデータ参照は許可しません。BIND_SOURCEと使用イベント自身の移動も未対応。
- イベントのoptionalはfalse、usageLimitはnull、追加costsは空、発動/解決条件は空all。効果処理内のIFと発動条件を混同しません。
- カード/対象/移動先の種類や所有者等の合法性は既存Compiler/Runtime/Movementで再検査します。ノード名が受理されても全組合せが実行可能とは限りません。

新しい効果命令・カード番号分岐・イベント専用解決器はありません。
旧19の一括DRAW/SEQUENCEは、その非公開draft方式を変更せず併存します。
実カードは追加承認せず、合成fixtureと`card-effect-interactive-event-examples.json`の2例を使います。
ST01-015相当の選択/KOの核を検証しても、未対応TRIGGER本文呼出を削ってカード全体を承認しません。

## 状態遷移と確定境界

[公式総合ルール ver.1.2.1](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=) 2-7-3に従う「公開→使用DON支払い→イベントをtrash→発動/解決」の順序は維持します。

```text
手札・未使用
  -> token/個体/generation/領域/actor/effectId/context/costをサーバー検証
  -> 非公開draftで公開・支払い・trash移動・共通Runtime作成
  -> 共通advanceを最初のchoice/work/完了まで実行（移動workは未適用）
  -> 宣言確定: 公開イベント・支払済みDON・trash・frame/gateを両者へ反映
  -> waitingForChoice: chooserだけに候補tokenと選択肢
  -> answer: 同じframeのbindings/pcを更新、盤面やDONを変更しない
  -> ready / waitingForWork
  -> 操作者がadvance / work。各workを既存の原子的commitで反映
  -> 次の選択、またはcompleted / outcome
```

初期draftが失敗した場合は公開・支払いを外部へ反映せず、元の試合とrequest receiptを不変にします。
宣言確定後はイベント使用と支払いが確定済みです。PR05aの「全処理終了まで非公開」を複数リクエストへ引き延ばしません。
選択token・未送信の選択・未適用workは未確定です。エラー応答でこれらを進めたり、支払済みDONを再び払ったりしません。
完了した前段workは確定済みであり、後段エラーでも公開情報や過去の支払いを巻き戻しません。
初期draft・answer・個々のworkの原子性と、効果全体の巻戻しは別の契約です。

## 権限・秘匿・再送

効果操作者は宣言したactorです。公開対象なら既存selector.chooserにOPPONENTを指定でき、操作者と選択者を分離します。
本人手札の選択は従来のSELF/OWNER_ONLY/SELF chooserに限定し、相手手札を選ばせるPR11は先取りしません。
候補は既存のサーバー列挙/filter/DerivedCardFactsが決定し、非公開の選択肢はchooser以外へ送信しません。
新20のイベントMAINの選択応答時には、tokenだけでなく現時点の個体/generation、領域、所有者/操作者、種類、公開権限、filterを再検査します。
不正なtoken、偽の対象ID、別プレイヤー、古いcontext、変更された同一requestIdは拒否します。
成功済みの同一要求は既存receiptでno-op。途中失敗した要求はreceiptを消費しないため、正しい入力で再試行できます。
選択/解決中の別MAIN・通常登場・ターン終了は既存gateで拒否します。

解決中の`mainEvent` DTOは使用したcardId、effectId、actor、paidCostのみ。相手にも見せる正当な公開情報です。
手札の個体IDや候補tokenは追加しません。新UIはイベント詳細と支払い済み表示を出し、既存V3ChoicePanelで選択を継続します。
「選ばずに続ける」はmin=0のaction選択だけに表示し、空配列を回答します。イベント全体の取消や返金ではありません。

## 0枚・不足・失敗の扱い

- min=0で候補0なら共通Runtimeが空bindingsとして続けます。候補がある場合も空回答で辞退できます。
- min>0の初回選択で不足する場合、初期draftで既存onInsufficient:failにより拒否し、使用を公開しません。
- 前段work後の後続SELECTで不足した場合は、そのadvanceを拒否して既存の解決ロックを維持します。勝手に0枚へ変換・効果終了・返金はしません。
- workが不正なら、そのworkは部分適用せず、既存blocked状態で停止します。既に確定した使用/前段workは残ります。
- 期限切れの回答も既存の期限検査で拒否し、未確認の自動辞退/自動再発行はしません。

後続不足・blocked・期限切れからの自動復旧や、管理者によるゲーム状態修復は今回未対応です。
検証用ルームではホストが既存のルーム復帰操作で終了できますが、これをルール上のイベント取消とは扱いません。
この安全停止条件を含めてカードJSONを個別レビューし、不適切なminや未対応の組合せを承認しないことが必要です。

## 保存と再開

プロセス内のActive/V3FixtureCoordinatorが、支払済み盤面・使用元・effectId・操作者・SOURCE ref・選択者を保持します。
既存v3-frame.9にはpc、scopes/bindings、選択肢とtoken、worldRevision、plan/Registry等のpinが保存され、各リクエストで署名検証して再開します。
署名付きframeの保存/復元とtoken保持を検証しましたが、試合全体のDB永続化/サーバー再起動/再接続復旧は実装していません。
frame単体の復元を「サーバー再起動をまたぐ対戦復旧」とは主張しません。

## 版と承認

| Schema | Compiler | Registry hash |
| --- | --- | --- |
| 3.0.0-subset.16 | v3-subset-compiler.16.3 | 44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763 |
| 3.0.0-subset.17 | v3-subset-compiler.17.1 | d18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9 |
| 3.0.0-subset.18 | v3-subset-compiler.18.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 |
| 3.0.0-subset.19 | v3-subset-compiler.19.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 |
| 3.0.0-subset.20 | v3-subset-compiler.20.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 |

命令は44のまま、Registryへの新規登録なし。旧16〜19のhash/受理範囲と既存14枚の承認は維持しました。
新20の対象再検査は旧frameへ黙って適用しません。Schemaだけ20へ変えて旧approvalを流用することも全14枚で拒否確認しました。

## 検証結果

新規24件: 核15、両座席Socket4、Schema3、任意選択UI1、クライアント選択権限1。
既存249件と合わせ273件成功、失敗0、skip0。Ajv 8で新旧Schemaと命令表を検証しました。
正常解決、再開、0枚、任意辞退、不足、改ざん、世代/領域/権限不一致、別chooser、古いrevision、再送/変更再送、割込み拒否、秘匿、エラー時の確定状態、KO、PR05a/14枚を含みます。
サーバー/フロントbuild成功。フロントは既存500KiB超チャンク警告のみ。iPhone実機の表示/タップ確認は未実施です。

```powershell
npm --prefix server run build
node --test server/test/v3-main-events.cjs server/test/v3-interactive-events.cjs server/test/v3-session-server.cjs
node tools/build-v3-event-schema.js --check
node docs/validate-card-effect-json.cjs --schema --examples docs/card-effect-interactive-event-examples.json
npm run build
npm run dev:effects-v3
```

合成モードのホスト側「イベント検証」を「イベント：対象選択」にして開始すると、手札イベントにmainDraw/targetChoice/handChoiceが登録されます。
これは固定の合成プログラムで、利用者が任意DSLを送って承認させる入口ではありません。既定の「一括処理」は19のままです。

## 変更規模・共通化

規模: 33ファイル（新規9・既存24）、追加5549行・削除125行。生成Schema2ファイルは4614行。生成物を除く全差分は追加935行・削除125行、そのうちサーバー/フロント実行ソースは追加94行・削除27行です。
大規模な解決器の書換えはありません。共通Runtimeに新20の回答時再検査を追加し、Coordinatorに宣言確定の分岐を追加しました。
独立したイベント解釈器、対象選択器、支払い器は作っていません。PR05aのfixtureセットアップもテスト共通helperへ抽出しました。
Schema20の実装用/資料用コピーは`tools/build-v3-event-schema.js`で旧19から生成し、`--check`と一致テストで検証します。旧19自体は変更しません。
生成物の追加行数を実行ソースの実装規模と区別します。全Schemaの大規模な組み替えや旧版の再生成は行いません。

## PR06以降・別作業に残すもの

条件付き誘発/新しいタイミング、汎用追加コスト/途中支払い（PR10）、相手の非公開手札（PR11）、継続/置換、SOURCE参照/自己移動、デッキ閲覧/並べ替え、本文呼出、未確認裁定、実カードの追加承認は保留です。
通常対戦・一人回し・通常ルーム処理を変更していません。
