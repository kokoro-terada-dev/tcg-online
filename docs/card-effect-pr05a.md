# PR05a: 単純イベントMAIN

日付: 2026-10-30。基準: `1dbf700`。対象は隔離v3のみ。PR05b以降は未実施です。

## 対応範囲

新Schema `3.0.0-subset.19`だけで、手札イベントのMAINを許可します。
安全に一括解決できる、SELFへのDRAWとSEQUENCEのみです。合計ドロー枚数は1〜50枚。
`optional:false, usageLimit:null, costs:[]`、発動条件/解決条件は空all、sourceZonesはhandに限定します。
条件分岐、対象選択、相手へのDRAW、追加発動コスト、SOURCE操作等はCompilerで拒否します。
空SEQUENCEも拒否。Schemaでは構造を検証し、合計枚数等の文脈制約はCompilerで追加検査します。
未知/NULLの使用costは0にせず使用候補から除外。現在の手札に未対応の修正/付与がある場合も候補にしません。
既存カウンター効果や場のMAINの許可範囲は変更していません。

全文例: `card-effect-main-event-examples.json`。未承認の合成例であり、実カードへの採用を意味しません。
実カードST01-015等は対象選択/TRIGGER本文呼出等が残るため、完成済みとは扱いません。

## 使用順序の根拠

[公式総合ルール ver.1.2.1（2026-08-28）](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=)の2-7-3、6-5-3-1、6-5-4-1を確認しました。
カードを公開し、使用costと同数のアクティブDONをレストし、そのイベントをトラッシュに置いてから効果を発動・解決します。
したがって「解決が終わってからトラッシュ」にはしません。原文の全文転載はせず条項を追跡します。

実装は以下の順序です。

1. Socket所属からactorを確定し、現在の手札の個体・世代・effectId・使用cost・タイミング・revision・tokenを検査。
2. 非公開draft上で、そのイベント1枚だけを両者向けにreveal。
3. 使用costの枚数だけACTIVE DONをRESTへ移す。0なら支払い操作なし。
4. イベントをhandから表向きtrashへ移す。generationが変わるため、新しいSOURCE refを取得。移動により一時reveal grantは消滅。
5. 移動イベントの証拠を`mainEventCause`として共通V3FixtureCoordinatorへ渡す。
6. 同じV3ResolutionMachine、advance、applyPendingWorkで最後まで解決。イベント独自のDRAW実装は作らない。
7. 完了/outcomeと全検査が成功した結果だけを試合へ一括反映して通知する。

宣言・公開・支払いの間にクライアントの選択待ちはありません。手順の途中状態を外部配信せず、サーバー内の移動イベントでは順序を保存します。
内部エラー/blocked/不正なwork/上限超過/未対応の派生誘発は、draft全体を破棄し、元の試合とreceiptを不変にします。
これは使用を取り消せるゲーム機能ではなく、成功要求の原子性です。成功して公開した情報を巻き戻すUIはありません。
デッキ0による勝敗は、既存の共通ドロー/outcome経路で処理し、使ったイベントはtrashに残ります。
使用costは定義のbaseStats.costを使いますが、今回の候補は未モデル化の手札cost修正がないものに限定しています。
効果の`costs`は追加発動コストであり別物です。PR05aでは空以外を受理しません。

## 識別と通信

`mainEventChoicesFor(actor)`は本人の手札の対応イベントだけを列挙します。
`sourceToken`はHMAC-SHA256で、`v3-main-event.1`、matchId、actor、完全なcontext、個体ID/generation、hand、effectId、cost、定義hashに結び付けます。
同名/同番号でも別個体のtokenです。旧tokenを別個体や移動後の世代へ付け替えません。
相手へはその手札の候補・token・画像alias・refを送信しません。使用後は使ったイベントだけが公開trashに見えます。

```ts
{ kind: "mainEvent", matchId, requestId, context, sourceToken, effectId }
```

source/cardId/actorの自己申告は受理しません。サーバーで候補を再評価します。
同じrequestId/同じ内容の再送は既存receiptでno-op。不正なtoken/effectId、古いrevision、変更した再送は拒否します。
解決/選択/誘発待ちやbattle中は候補に出ず、別のMAINへ割り込めません。

フロントは自分の手札イベントをタップし、既存中央モーダルからMAINを選びます。
共有TestBoardへの変更は任意の`onTestEvent`コールバックのみで、指定しない既存画面の操作は変えません。
合成モードのイベントにMAIN DRAW1を追加しました。従来COUNTERは残し、合成データだけをsession-event.8へ更新しました。
実カードの承認manifestは変更していません。

## 版・互換性

| Schema | Compiler | Registry hash |
| --- | --- | --- |
| 3.0.0-subset.16 | v3-subset-compiler.16.3 | 44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763 |
| 3.0.0-subset.17 | v3-subset-compiler.17.1 | d18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9 |
| 3.0.0-subset.18 | v3-subset-compiler.18.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 |
| 3.0.0-subset.19 | v3-subset-compiler.19.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 |

新命令は0件、19のRegistryは18と同じ44命令。変更したのはSchema/Compilerのevent×MAINの許可範囲です。
既存MAIN/DRAW/SEQUENCEの命令バージョンやframe v3-frame.9は変更しません。
既存14枚の定義・出典・承認は旧16のまま。Schemaだけ19へ変えて旧approvalを流用できないことを全14枚で検査しました。
旧カタログのhashを機械的に更新していません。

## テストとビルド

新規19件: MAINイベント核13件、両座席Socket2件、フロントのcommand/dialog各1件、Schema2件。
関連合計249件成功、失敗0、skip0。Ajv 8による旧16/17/18と新19の検査を実施しました。
0cost/ちょうど/不足、相手ターン/battle、COUNTERのみ、同番号別個体、退場した手札、偽造token/effectId/権限、古いrevision、再送、公開順序、使用後trash、手札秘匿、途中2回目のwork失敗時の完全破棄、デッキ切れ、既存14枚を検証しています。
サーバー/フロントbuild成功。フロントは従来の500KiB超チャンク警告のみ。iPhone実機確認は未実施です。

```powershell
npm --prefix server run build
node --test server/test/v3-main-events.cjs server/test/v3-counter-events.cjs server/test/v3-session-server.cjs
node --test tools/test-v3-main-event-schema.test.js
node docs/validate-card-effect-json.cjs --schema --examples docs/card-effect-main-event-examples.json
npm run build
```

Schema検証には既存ガイドの一時Ajv 8/NODE_PATHを使います。ゲーム依存パッケージの追加はありません。

## 変更規模

規模: 32ファイル（新規7・既存25）、追加4808行・削除102行。うちSchemaの同一スナップショット2ファイルが4116行、サーバー/フロント実行ソースは追加131行・削除33行です。
大規模に書き換えた既存解決器はありません。matchCoordinatorに候補/使用入口を追加し、fixtureCoordinatorにはイベントMAINの発動元証拠の許可だけを追加しました。
counterEvents内の既存支払い/移動をprepareEventFromHandへ抽出し、MAIN/COUNTERで再利用しました。COUNTERの新機能実装ではありません。
イベント独自の解釈器・DRAW実装・コスト計算器は作らず、simpleMainEventは許可範囲の検査だけを行います。
行数の大半を占める新Schema2ファイルは、旧18を維持するための版固定スナップショットとドキュメント向けの同一コピーです。実行コードの全面書換えではありません。
このSchemaコピーは深い一致をテストしています。将来、ドキュメント出力の自動生成で重複を減らせます。
prepareEventFromHandのファイル位置や、発動元token生成の名前付き共通化も、PR05bで契約が増えた段階で検討できます。現段階では小さな重複のために許可範囲の違う入口を統合しません。

## PR05b以降に残すこと

対象選択/任意発動、解決途中の支払い・条件分岐、複雑な中断/再開、宣言/公開の段階的UI、相手へ確認を求める操作、追加cost、SOURCE自身の操作、継続/置換/本文呼出は未実施です。
未知の裁定やST01-015等の残り能力を推測せず、未対応能力を落として実カード全体を承認しません。
通常対戦・一人回し・通常サーバーのルーム処理も変更していません。
