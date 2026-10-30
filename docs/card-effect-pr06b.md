# PR06b 誘発候補の順序選択と解決

基準: `faa66c6`。PR06bのみ実装。PR07以降へは進んでいません。

## 実装

- 新Schema `3.0.0-subset.22` / Compiler `v3-subset-compiler.22.1`。
- `ON_EVENT@1`でPR06aの既知・成立した候補を既存ScheduledTriggerキューへ登録。
  旧21の`ON_EVENT@candidate.1`は検出・保留のみを維持します。JSONの版だけ変えて既存approvalを流用できません。
- 新Registry hash: `97e2b8f51421bba99ad1c802f7820275f9dccfa013231a62f05919b3298d74e1`。
  新旧とも46登録。旧16〜21のRegistry hashと既存14枚の承認を変更していません。
- 旧RuntimeのOPTIONAL/COSTS/SELECT/WORK/解決条件を再利用。独立した解決器・イベントバス・カード番号分岐はありません。
- 同一イベントの既存ON_PLAY等とON_EVENTは同じbatchに接続。新規候補のみのbatchは既存transaction証拠で識別。
  同じbatch内では既存chooser処理を使い、ターンプレイヤー側の候補から任意の次の1件を選択します。
  解決途中で生じた新しいbatchは、先に待機していたbatchを追い越しません。
- UIでは個体の公開位置・effectIdを表示し、同名の別個体や同じカードの別効果を区別します。

## 発生時と解決時

台帳の遷移は`PENDING -> RESOLVING -> RESOLVED`。任意発動を辞退しても候補自体は完了し、使用回数は消費しません。
既知の回数制限に到達した後の候補は`SKIPPED/USAGE_EXHAUSTED`。UNKNOWN/旧21/不正な世代は自動解決せずHELDです。

1. PR06aのsnapshot・条件評価結果を保存。台帳の発生条件を解決時盤面で再評価しません。
2. 順序選択要求は既存のrequestId/revision/room所属と、サーバー発行token・chooserで検査。
3. 個体・世代・領域・操作者・可視性・definitionHashを再検査。発動元が移動した場合は新世代へ付け替えません。
4. fixture Coordinatorがサーバー内部のbrand付き発生証拠を検査。フィールドをコピーしただけの偽証拠は拒否。
5. 共通Runtimeの先頭で`OCCURRENCE_CHECK`を行い、認可済み発生結果を確認。以降の解決条件・IF・選択対象・支払いは現在盤面を参照。
6. 共通frameの選択待機からanswer/advance/workで再開。選択者と効果操作者の権限を分離。
7. 完了時に候補を消費し、次の候補を提示。途中の移動から発生した候補も同じ台帳へ記録。

フレームは`v3-frame.9`のまま。新profileの命令はCompiler/Registry/definition pinで区別し、旧frameのプログラムを黙って変更しません。

## 原子性・再送・秘匿

- 候補の開始前に検査を完了。無効なtoken/別chooser/古いrevision/コピーされた証拠では盤面・台帳・支払いを変更しません。
- 成功した要求の再送は既存receiptを返し、候補開始・DON支払い・カード移動・DRAWを重複実行しません。
- 順序選択tokenはその時の選択者にだけ送信。発生snapshot、台帳、原因の非公開カード情報はDTOに含めません。
- 選択中は他のMAINや別候補を開始不可。共通Runtimeの選択回答時検査を新22にも適用し、対象世代/領域/所有者/可視性/filterを再確認。
- 手札の候補は既存の本人向け投影のみ。非公開Queryの真偽はPR06a同様UNKNOWN保留。
- 支払い不足や後続のエラーで公開済み情報を巻き戻しません。既存のblocked状態・ロックを維持し、払い戻しや自動辞退はしません。
- キュー128件・イベント512件・台帳4096判定・既存frame/receipt上限を維持。既存の上限に加え、候補追加を盤面確定前に検査。

## 裁定の確認と対応境界

必要な解決順の箇所だけ[公式総合ルール ver.1.2.1（2026-08-28）](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240419=)を確認しました。
8-6-1/8-6-1-1/8-6-3を根拠に、先行する待機グループを保った順序選択と、解決中の割込み禁止を既存キューへ接続しています。
8-1-3-1-3の発動元の領域移動に関する制限を踏まえ、古いrefを新しい個体世代として解決しません。
ただし自己KO等の参照契約を一括で決めたわけではなく、新ON_EVENTの移動済みSOURCEは安全側の保留を維持します。
ダメージ中の複数誘発やLKIの詳細を、この確認だけで全面対応済みとはしません。

未対応・保留:

- 複数の非DON移動を含むtransactionの各イベント時点・同時性の確定（PR06aのUNKNOWNを維持）。同じ1イベントで複数の効果が成立する順序選択には対応。
- 非公開Query、未知のFacts、移動済みSOURCEの個別裁定/領域外参照。UNKNOWNをfalse/0へ変換しません。
- DON返却の個別監視。今回の対象はPR06aが生成可能な候補に限定し、新しいDON条件や操作命令は追加していません。
- MAIN以外の自動フェイズ境界で発生する新22候補は`HELD/NON_MAIN_BOUNDARY`。物理checkpointを二重実行するような復帰処理は追加せず、PR07を先取りしません。
- blocked/HELDからの管理者復旧、自動取消/払い戻し、サーバー再起動をまたぐ試合全体の永続化。
- 実カードの追加承認。カード本文の一部だけ対応してカード全体を承認することはしていません。

## テスト

**341件成功、失敗0、skip0**。既存323件と新規18件（核15、両座席Socket2、Schema/命令一覧1）。
同時候補の任意順、両操作者の順序、派生イベント、発生/解決条件の差、別chooser、0枚選択、任意辞退、コスト/使用回数、再送、古いrevision、偽証拠、古い対象世代、SOURCE移動、UNKNOWN、非公開手札、フェイズ保留を検証しました。
PR05a/bと既存14枚の回帰、サーバー/フロントbuild成功。Schema21/22の生成物一致も確認。
フロントの既存500KiB超チャンク警告のみ。iPhone実機の目視検証は行っていません。

```powershell
npm --prefix server run build
node --test server/test/v3-observed-resolution.cjs server/test/v3-session-server.cjs
node tools/build-v3-resolving-trigger-schema.js --check
npm run build
```

Schemaテストには既存の外部Ajv 8をNODE_PATHで使用。依存パッケージやlockfileは変更していません。

## 確認方法

PR06b版ローカルURL: http://127.0.0.1:5194/ 。既存5190等のNodeバックエンドには今回の追加モードが読み込まれていません。
テスト対戦の合成モードで両者がデッキを選択・READY後、HOSTは「誘発：順序と対象選択」を選んで開始します。
キャラを手札から登場させると、元の自身ON_PLAYと、リーダーの合成watchDraw/watchHandが同時候補として表示されます。
watchHandは共通SELECTの本人手札表示と再開を検証する合成効果です。実カードの能力ではありません。
通常対戦・一人回し・既存の限定実カードプリセットへ、この合成能力を追加していません。

## 変更規模・ファイル

26ファイル（新規8・既存18）、追加5688行・削除93行。生成Schema2ファイル（4926行）を除くと追加762行・削除93行。実行ソースのみは追加113行・削除41行です。
共通解決器や選択器の大規模な書換えはなく、Runtimeの発生証拠チェックと回答時検査、既存キューへの接続が中心です。
変更ファイルの全一覧と変更ファイルだけのZIPは、git管理外`local-data/v3-pr06b-changed-files-20261030.md`と`local-data/v3-pr06b-20261030.zip`に出力します。
