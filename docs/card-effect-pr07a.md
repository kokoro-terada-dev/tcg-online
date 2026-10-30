# PR07a ブロックとフェイズ境界

基準コミット: `7cae9b7`。PR07aのみ。PR07b以降の持続期間管理は実装していません。

## 追加タイミング

新Schema `3.0.0-subset.23` / Compiler `v3-subset-compiler.23.1`。
Registryは49登録、hashは`2a106a66a4e1d2547d57cc2ec65e39283d2fb4a722b6adbd4951b9f084d9bf04`。

| Timing | JSON | 発生箇所 |
| --- | --- | --- |
| ON_BLOCK | `{"type":"ON_BLOCK"}` | 正常なブロッカー宣言とレストが成立し、攻撃先が変更された後。カウンター移行前 |
| MAIN_START | `{"type":"MAIN_START","player":"SELF"}` | 通常のrefresh/draw/DON処理後、メインフェイズ開始時。手動MAIN操作前 |
| TURN_END | `{"type":"TURN_END","player":"OPPONENT"}` | 対象プレイヤーのエンドフェイズ入口。既存のターン終了修正解除前 |

MAIN_START/TURN_ENDのplayerはSELF/OPPONENT。効果操作者に対する対象ターンのプレイヤーを明示します。
ON_BLOCKの発動元はcharacterのみ。他2種は公開leader/character/stageを対象にします。
新ノードはtriggeredとしてのみ使用でき、既存のactivationConditions、resolutionConditions、optional、usageLimit、costs、actionsと合成できます。
旧22以前にこれらのTimingを追加受理せず、各旧Registry hashと既存14枚の承認を維持します。

## 公式根拠と範囲の決定

必要な箇所だけ[公式総合ルール ver.1.2.1、2026-08-28](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20240419=)を参照しました。
MAIN_STARTは6-5-1、終了時は6-6-1-1〜1-4、ブロック時は10-2-15-1/7-1-2-2を根拠に、上の具体的な境界に固定しました。
曖昧な「ターン開始」一般に読み替えず、TURN_STARTという新命令は追加していません。
終了時効果の後に既存の修正解除へ進む配置は6-6-1-2以降を参照。新しいDuration/期限カウンタ/UNTIL_BOUNDARYはありません。
同時候補・派生候補はPR06bのキューと解決順を維持します。
OP01-039/OP01-078等のカード全体を対応済みとせず、COUNTを使うブロック条件などを合成fixtureで検証しています。DON条件等を省略して実カードを承認していません。

## イベントと候補

- EventContextへtyped boundaryを追加。イベント種別/ID、phaseToken、ターン番号、activePlayer、battleId、blockerの個体・世代を保持。
- 既存のTriggerObservations台帳・brand付き発生証拠を拡張し、既存ScheduledTriggerのON_EVENT経路から共通Runtimeへ渡します。
  新しいイベントバス、別の効果解決器、カード番号分岐はありません。
- 境界は`OCCURRENCE` snapshotとして記録。SOURCEのowner/controller、効果操作者、イベントのactivePlayer、選択者は別に扱います。
- 発生条件は共通Evaluator/Facts/QUERY/COUNTで評価し保存。解決時の条件・対象は現在盤面で検査。UNKNOWNはHELDのままです。
- 同一battleのブロック事実、同一phaseTokenの境界を再通知しても候補を重複生成しません。内容の異なる同じeventIdは拒否。
- 公開領域・世代・所有者・操作者・definitionHashの検査、候補128/イベント512/台帳4096等の上限を維持します。
- 境界の内部台帳・非公開カード情報はDTOへ送りません。順序選択tokenと選択候補は権限のあるクライアントのみ。

## ブロック時

通常のレスト、REST_SOURCE支払い、ブロックしない選択ではON_BLOCKを発行しません。
新Timingを持つ構成だけblock stepを保留し、ブロック効果と派生候補の解決後に既存の参加カード検査からcounterへ進みます。
参加カードが消えた場合のバトル終了も同じ検査経路です。旧構成は従来の即時counter移行を維持します。
効果解決中・選択中は別のブロック/MAIN/候補開始を拒否。発動元が移動して古い世代になった候補は新世代へ付け替えません。

## フェイズの中断と再開

新23の開始/終了Timingがある試合だけ、境界を挟めるphase continuationを利用します。旧構成の進行経路は維持します。
通常のrefresh/draw/DON移動は既存処理を共通helperへ抽出して再利用し、別の移動ルールを作っていません。

1. MAIN終了宣言からendへ移り、TURN_ENDの候補を記録。
2. 自分の終了時候補から順序選択し、その後に相手の終了時候補を解決。途中のSELECT/支払い/workは共通frameで待機・再開。
3. 候補がなくなったら、現在のターンプレイヤーの「フェイズを進める」で既存の修正解除と通常フェイズ処理を続行。
4. refresh/draw/DON後、mainの未確定入口でMAIN_STARTを記録。解決後の続行でmainを確定し、手動操作を解放。

phaseToken別の処理済み境界を保持し、再送や途中再開でも通常ドロー・DON追加を二重実行しません。
新しいターンに入った時だけ使用回数を初期化し、終了時効果の解決中に同じターンの回数を消しません。
初回MAIN_STARTは実際の未確定main入口から開始した構成で検出します。既にmain確定済みの旧試合に過去の境界を捏造しません。
新しいphase flowはローカルdraftで準備し、検査成功後に盤面・phase・台帳・続行状態を確定します。
勝敗が確定すれば後続フェイズへ進みません。失敗やUNKNOWNを自動辞退・払い戻し・繰り返しドローで復旧しません。

## 互換性・非対象

- 通常対戦、一人回し、通常ルーム、既存14枚のdefinition/source/approval manifestに変更なし。
- Schema16〜22/旧Compiler/旧Registry hashを維持。Duration Registryは旧22と同一。
- v3-frame.9と既存requestId/revision/署名・選択token・二重適用防止を維持。
- より広いフェイズの誘発許可は新23の該当Timingを含む構成だけに限定し、旧構成の発動可能範囲を拡張しません。
- 追加Timingの検証用能力は固定の合成プログラムです。利用者の任意JSONや未承認実カードを実行する入口を作っていません。

保留: PR07bの期限拡張、一般のTURN_START、追加/スキップターン、新しいHAS_ABILITYタグ、DON返却監視、曖昧な複数移動の同時性、非公開Query、移動後SOURCEの個別裁定、管理者復旧・試合全体の再起動復旧。
フェイズcheckpoint中の一般的なON_EVENT移動監視はPR06bの安全側保留を維持し、今回の境界Timing対応と混同しません。

## 検証

**360件成功、失敗0、skip0**。既存341件と新規19件（核14、両座席Socket2、Schema/命令表2、クライアント権限1）。
ブロック事実と単なるレストの区別、COUNT成立/不成立、UNKNOWN、自己/相手終了順、任意順選択、世代変更、非公開手札、別chooser、不正応答、古いrevision、再送、初回main、checkpoint一度だけ、既存修正解除順を確認しました。
既存14枚/PR05b/PR06b/旧hashを含む全v3回帰、サーバーbuild、フロントbuild成功。フロントは既存500KiB超チャンク警告のみ。
Schema23生成物一致、旧版拒否、Duration語彙不変も確認。Ajv 8は既存外部検証ディレクトリのNODE_PATHを利用し、依存/lockfileは変更なし。
iPhone実機での目視・操作確認、個別実カード全体の追加承認は実施していません。

```powershell
npm --prefix server run build
node --test server/test/v3-boundary-timings.cjs
node tools/build-v3-boundary-schema.js --check
npm run build
```

## 確認用画面

今回のローカルURLは http://127.0.0.1:5195/ 。旧5190等のバックエンドには追加モードが読み込まれていません。
2端末のテスト対戦・合成モードでデッキ選択/READY後、「誘発：ブロック・開始・終了」を選択して開始します。
「フェイズを進める」から初回の開始時効果を解決し、その後に手動MAIN操作が可能になります。
キャラのブロック時、リーダーの自己MAIN開始/自己ターン終了で合成DRAWが発生します。正式な実カード能力ではありません。

## 変更規模・一覧

28ファイル（新規7・既存21）、追加5915行・削除108行。生成Schema2ファイル（5100行）を除くと追加815行・削除108行。実行ソースのみは追加205行・削除54行です。
共通Runtimeと既存のキュー/phase work/移動・バトル検査を再利用。phase movementの抽出は再開時に同じ処理を使うための限定的な変更です。
全ファイル一覧: `local-data/v3-pr07a-changed-files-20261030.md`。変更ファイルのみのZIP: `local-data/v3-pr07a-20261030.zip`。いずれもgit管理外に保存します。
