# PR06a 条件付き誘発の候補検出

実装日: 2026-10-30。基準コミット: `fe6e037`（PR05b）。PR06aのみ。PR06b以降は実装していません。
通常対戦・一人回し・通常ルーム経路は変更していません。実カードの追加承認、承認manifestの更新はありません。

## 対応範囲

- 新Schema `3.0.0-subset.21`、Compiler `v3-subset-compiler.21.1`。
- Timing `ON_EVENT@candidate.1`: **候補検出・検証のみ**。新候補は解決器へ投入しません。
- Predicate `TURN_IS@1`: SELF/OPPONENTを効果操作者に対して評価。既存のall/any/notと合成可能。
- CARD_NAME/CARD_METADATA/HAS_ABILITY、compare、QUERY_CARDS/EXISTS/COUNTは既存のfixtureEnvironment/Factsで評価。
- TRUEはHELD/PR06B_REQUIRED、FALSEはNOT_MATCHED/CONDITION_FALSE、UNKNOWNはHELD/UNKNOWN_FACTS。
- この段階で任意発動・コスト支払い・使用回数消費・actions/resolutionConditionsの評価は実行しません。
  新timingを直接V3ResolutionMachineへ渡しても拒否します。「候補を検出できる」と「効果を実行できる」は別です。

## DSL

```json
{
  "type": "ON_EVENT",
  "event": "CARD_ENTERED",
  "snapshot": "TRANSACTION_AFTER",
  "relation": "OTHER",
  "owner": "SELF",
  "controller": "SELF",
  "fromZones": ["hand"],
  "toZones": ["character"],
  "cardTypes": ["character"],
  "filters": {
    "type": "CARD_METADATA", "subject": "CANDIDATE", "basis": "PRINTED",
    "field": "traits", "match": "ANY", "comparison": "EXACT", "values": ["麦わらの一味"]
  }
}
```

全パラメータ必須。`event`はCARD_ENTERED/CARD_KO/CARD_MOVED。
ENTEREDはcharacter/stageへ実際に移動した場合。KOは既存isKOとBATTLE_KO/EFFECT_KO、character→trashの証拠が必要。
MOVE_CARDによる直接trash、コスト支払い、ルール処理をKOに読み替えません。
`relation`はSELF/OTHER/ANY。SELF/OTHERは移動をまたぐ**同じ個体ID**の判定で、発動元ref自体は選んだsnapshotの世代を保持します。
`owner/controller`はそれぞれSELF/OPPONENT/ANY。効果操作者・イベントの操作プレイヤー・所有者・選択者は別です。
`fromZones/toZones`はhand/deck/life/trash/public/character/stageの重複なし非空集合。
`cardTypes`はcharacter/stage/eventの重複なし非空集合。DON/領域外resolvingの汎用誘発は未対応です。
監視する発動元は公開leader/character/stageのみ。移動前SOURCEを読む場合はTRANSACTION_BEFORE、登場した新SOURCEを読む場合はTRANSACTION_AFTERを明示します。
filtersのCANDIDATEはイベント対象です。activationConditionsのSOURCEは監視するカードです。
`{"type":"TURN_IS","player":"SELF"}`などをactivationConditionsへ指定します。旧timingの発生条件を解決時IFへ移していません。
新timing以外のtriggeredは従来通りactivationConditionsが空allである必要があります。
完全な合成CardDefinitionは`card-effect-conditional-trigger-examples.json`にあり、Schema/Compiler検証済みですが未承認です。

## イベント証拠から候補まで

1. 新ON_EVENT定義を含む隔離v3試合だけMovementStoreの発生証拠記録を有効化します。
2. 既存commitが発行する同じMovementEventへWeakMapでtransactionの不変before/after盤面を関連付けます。
   新しいバスや二重通知は作りません。DTOへ盤面snapshotやWeakMapを追加しません。旧試合は記録しません。
3. 選んだsnapshot内の公開発動元を列挙。event/from/to/SELF・OTHERを照合し、共通Evaluatorで対象filterと発生条件を評価します。
4. match/eventId/発動元個体・世代/effectId/definitionHashから候補keyを生成。同じeventの再通知は重複しません。内容の違う同じeventIdは拒否します。
5. actor/effectController/sourceOwner/sourceController/chooser、原因source・resolutionId・分かる場合のeffectId、対象の前後世代、from/to、turn、activePlayer、transactionId/groupId/operationIndexをサーバー内部へ保存します。
6. 候補記録はmatchリクエスト内draftで作り、既存の処理成功後だけ確定。fixtureのworkも既存のcommit前検査に接続します。
   候補上限や証拠検証の失敗は盤面適用前に拒否します。記録は最大512イベント/4096判定、既存の各種上限も維持します。

transactionIdは共通の物理transaction、groupIdは同一operationに属する移動（付与DONの自動返却等）の識別です。
これらを公式ルール上の「同時誘発順序」として解釈していません。
複数の非DON移動を含むtransactionは、**各移動の発生時点をtransaction境界だけから確定できない**ためUNKNOWN/MULTI_MOVE_TIMING_UNRESOLVEDです。
途中盤面を推測して再構築せず、PR06b以降の検討に残します。単一移動の前後評価と明示snapshotをまず安全に提供する設計です。

## 保留・再開・秘匿

- サーバー内部台帳をクライアントへ送信しません。新候補に実行tokenはありません。
- 相手が見られないカードは共通Factsの権限検査でUNKNOWN。欠損パワー等を0にしません。
- 新ON_EVENT内の非公開Queryは、成立/不成立が公開保留フラグから漏れることも避けるためUNKNOWN保留。
  既存Query自体の権限や結果は変更していません。この追加制限を「非公開集合判定に完全対応」とは扱いません。
- 公開DTOは任意フィールドconditionalTriggerHoldだけ。詳細ID/非公開カード名/候補数/未知の理由は送りません。
- 進行中の共通frameのadvance/answer/workは、既存の選択者・操作者・revision・署名付きtoken検査を維持して続行できます。
  途中で発生する新イベントも捕捉します。frame完了後は新MAIN/移動/バトル/ターン操作を安全停止します。
- ターンの自動フェイズ処理で検出した場合はそのcheckpointで停止し、後続の自動処理へ進みません。
- バトルKO後も候補を無視してダメージ処理を自動終了しません。
- UNKNOWNや移動済みSOURCEを自動的に辞退扱いにしません。validateObservedSourceは現在盤面で世代/領域/操作者/定義hashを再検証し、CURRENT/STALEを返します。
  過去の成立結果は解決時盤面で再計算・新世代へ付け替えしません。
- 循環誘発は新候補を自動実行しないことで防止。台帳の上限超過は明示拒否します。
- 手動MAIN入口、PR05a/bの使用・公開・支払い・trash順、二重送信のreceiptは共通の既存経路です。

## 原文確認と裁定保留

提供CSVのSHA256は`cb0695bb48d2d73b4fe5d9931a71e0980be8e7ea7dadbb8bfb4d605b0eb8cb55`。
OP10-042（T07）の公開原文には相手ターン・特徴ドレスローザのキャラ・KOまたは相手効果で場を離れる条件があります。
表示IDごとの文順差異はPR00のsource_holdを維持し、ORの公式意味/自身を含むか/条件確認時点等を新たに確定していません。
EB03-031（T12）は自ターン登場条件と、DON-1・リーダー名・trashイベント本文呼出を含みます。
今回のテストはこれらの**条件文節を分解した合成fixture**であり、両カード全体を再現・承認したものではありません。
使用回数、原因を条件にする新Predicate、継続効果、本文呼出、公式LKI/同時誘発裁定は保留です。
原文は提供CSVの表示ID/出典URLと既存レビュー台帳を根拠に確認しました。新しい公式裁定を取得・確認したと主張しません。

## 版と互換性

| Schema | Compiler | Registry hash |
| --- | --- | --- |
| 16 | v3-subset-compiler.16.3 | 44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763 |
| 17 | v3-subset-compiler.17.1 | d18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9 |
| 18 / 19 / 20 | v3-subset-compiler.18.1 / 19.1 / 20.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 |
| 21 | v3-subset-compiler.21.1 | b283c93467d4f993aeb8294a8154da85476c7e8657079a45842b13f279930b2e |

新21は46登録（うちON_EVENTは検出のみ）。旧16〜20のRegistryと受理範囲・承認hashを維持。
既存14枚のdefinition/source/approval manifestを変更していません。frameはv3-frame.9のままです。
Schema21の実装用/資料用コピーは固定20から生成し、旧版を再生成しません。
LF正規化SHA256: Schema21は`c1b9a5d66abdd58cb60fe428bbe5aaa31a1fb306d48ff88a5f25e776d091c494`、Compilerソースは`ee768ef80fd397e2f5d10b514d275a526d5e2b5050b5f1a99b57e93fb76a05eb`。
Compilerソースhashは実装ファイルの識別用であり、承認に用いるRegistry/definition/source hashの代わりではありません。

## 検証

最終結果: **323件成功、失敗0、skip0**。今回追加27件（候補検出23、Schema/命令表3、クライアント保留1）。既存296件を含みます。
既存14枚、PR05aのDRAW/SEQUENCE、PR05bの選択・再開、両クライアントの秘匿、古いrevision/再送、移動/世代、旧hashの回帰を確認しました。
新テストはSELF/OTHER、自他、印刷特徴・能力、TURN_IS、発生時COUNT、KOと直接trash、複数移動の保留、UNKNOWN、手札Query、SOURCE移動、上限/原子性、frame再開中のKO、ターンcheckpoint、デッキ切れ勝敗の優先を含みます。
サーバー/フロントbuild成功。Schema21/旧20の生成物一致、全資料サンプル21件のSchema/Compiler検証も失敗0です。
フロントは既存の500KiB超チャンク警告のみ。原文CSVのSHA256も照合しました。

```powershell
npm --prefix server run build
node --test "server/test/v3-*.cjs"
node tools/build-v3-trigger-schema.js --check
node docs/validate-card-effect-json.cjs --schema --examples docs/card-effect-conditional-trigger-examples.json
npm run build
```

Ajv 8は既存の外部検証用ディレクトリをNODE_PATHへ設定して利用。依存パッケージやlockfileは変更していません。
iPhone実機確認、実カード全体の新規検証/承認は行っていません。

## 修正規模

規模: 30ファイル（新規10・既存20）、追加6004行・削除80行。生成Schema2ファイルは追加4926行。生成物を除く差分は追加1078行・削除80行、うちサーバー/フロントの実行ソースは追加220行・削除24行です。
共通解決器・選択器・Predicate評価を使い回し、別イベント実行器・別イベントバスを作っていません。
移動coreの変更はopt-inの記録継承/関連付けだけです。既存処理の大規模な書換えはありません。

## PR06b以降に残すもの

新候補の実行・並べ替え・同時誘発・任意発動・コスト/ターン1回の消費、個別イベント時点の厳密snapshot、非公開Queryの安全な公開境界、移動後SOURCEの公式参照規則、その他のtimingを残します。
中断後の管理者復旧・自動取消・払い戻し・サーバー再起動をまたぐDB復旧も未対応。
WeakMap証拠やframe単体の保存を、試合全体の永続化と呼びません。
保留解除の操作は今回追加せず、検証セッション終了は既存のルーム復帰経路を利用します。
変更ファイル一覧は`local-data/v3-pr06a-changed-files-20261030.md`、変更ファイルのみのZIPは`local-data/v3-pr06a-20261030.zip`（いずれもgit管理外）へ出力します。
