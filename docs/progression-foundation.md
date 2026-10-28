# ターン・フェーズ管理：独立基盤フェーズ

## 今回の範囲

効果DSLの次段階として、進行状態と操作タイミングだけを純粋関数で管理します。
`server/src/test/progression/` は既存ゲーム・サーバー起動処理・UIから読み込みません。
画面にターン制限を追加したり、既存の手動操作を禁止したりする変更ではありません。

カードのリフレッシュ、ドロー、DON移動、支払い、効果実行、パワー計算、ダメージ、勝敗の自動判定は今回行いません。
既存Matchへこの状態を追加する作業もまだ行いません。

## 参照したルールと設計上の境界

[公式総合ルール ver.1.2.1（2026-08-28）](https://www.onepiece-cardgame.com/pdf/rule_comprehensive.pdf?20260828=) の6章・7章を確認しました。
基本フェーズは refresh → draw → don → main → end、バトル内は attack → block → counter → damage → end として保持します。
先攻最初の通常ドロー枚数とDON枚数、両者それぞれの最初のターンのバトル制限を基本タイミングに反映します（6-3、6-4、6-5-6）。
バトル参加カードが場を離れた場合の経路も考慮します（7-1-1～7-1-3）。
個別効果による例外は別のルール層で扱い、ここで独自の裁定を作りません。

以下のAPI・チェックポイント・revisionはアプリ内部の設計であり、公式ルールの用語や追加ルールではありません。

## 状態

| 項目 | 内容 |
| --- | --- |
| version | 保存形式番号。現在1。外部データからの復元APIは未実装 |
| revision | 各成功遷移で1増加。古い・不正なrevisionは拒否 |
| firstPlayer | 先攻プレイヤー0または1。ホスト・上下の見た目では決めない |
| activePlayer | 現在の手番プレイヤー |
| turnNumber | 両者を通じた通算ターン。各自のターン番号はfirstPlayerから算出 |
| phase / phaseToken | 現在のフェーズと、通算ターンを含むチェックポイントID |
| phaseSettled | 必要な処理をサーバーが完了したと確認済みか |
| battle | 攻撃元・対象のinstanceId/generation、攻守、ステップ、判断・処理の完了状態 |
| gate | idle / resolving / choice。効果解決と選択待ちの停止状態 |
| outcome | 検証済みのゲーム終了通知。勝敗を計算するものではない |

状態は読み取り専用・freeze済みです。遷移は新しい状態を返し、元の状態・渡されたカード参照を変更しません。
同じ結果が二重適用されないよう、古いrevision、phaseToken、battleId/step、resolutionId、selectionIdを確認します。
このモジュール単独ではrequestIdの再送キャッシュを持ちません。接続時は既存の要求管理と対戦単位の直列処理を併用します。

## フェーズの進行

1. createProgressionで先攻を指定し、最初のrefreshに入る。
2. phaseWorkで、そのフェーズが必要とするチェックポイントの説明を取得する。
3. 将来の実行器が、その段階のルール処理・効果・選択を完了させる。
4. settlePhaseで完了を記録する。
5. advancePhaseで次へ進む。mainだけは手番側のendMain宣言が必要。

phaseWorkが返すnormalCount/normalMaximumは通常処理の説明です。カード効果による例外、山札切れ、DON不足、実際の移動は計算・実行しません。
mainへ入った直後も開始時効果などのチェックポイントが完了するまでは自由操作を許可しません。
endの終了処理・期限解除を省略して次ターンへ進めないよう、endにも完了確認が必要です。
エンド内部の細かい解決順は今後のResolutionEngineで扱います。settlePhaseをクライアントに押させて代替しません。

## バトルと判断するプレイヤー

手番は攻撃側のまま保持し、防御側の判断権を別に扱います。
startBattleはタイミング確認後に攻撃元と対象の参照を保持します。所属・種類・レスト状態・登場ターン・攻撃制限は将来のカード合法性検証層で確認してから呼びます。

| ステップ | 判断・完了確認 |
| --- | --- |
| attack | アタック時効果などの処理後にサーバーが完了確認 |
| block | 防御側のpassBlock、または検証済みブロックのredirectBattleが必要 |
| counter | 防御側はタイミング上counterEffectが可能。endCounterで判断を終える |
| damage | 将来のダメージ処理器が完了後にサーバーが確認 |
| end | 終了時効果・期限解除などの処理後、mainへ戻る |

各ステップは、判断の完了と処理の完了を分けます。settleBattleStep前のadvanceBattleは拒否します。
redirectBattleは対象だけを変更し、元の攻撃元は保持します。二重ブロック・判断完了後の変更は拒否します。
advanceBattleのparticipantsPresentは、実体・generationを調べたサーバーが渡す結果です。クライアントの申告を信用してはいけません。
ブロックの能力・コスト・対象の合法性、カードのレストや画像・矢印更新は今回実装していません。

## 効果解決と選択待ち

beginResolution → waitForChoice → acceptChoice → finishResolutionを独立したgateとして保持します。
gateがidleでない間、通常メイン操作・フェーズ移行・バトル移行を停止します。待機中も現在のフェーズとバトルの進行位置を保持します。
候補の選択者は効果のcontrollerと同じとは限りません。chooserを独立して保持します。
checkChoiceResponderは選択者とIDの整合だけを確認します。選択枚数・候補・公開範囲の検証ではありません。
acceptChoiceは将来のSelectorが回答の合法性を確認した後でのみ呼びます。回答のカードIDをそのまま状態へ格納しません。
解決中の別の解決開始や、選択待ちを飛ばした完了は拒否します。入れ子や新規誘発は今後の解決キューで扱い、gateを上書きしません。
triggerEffectはダメージ由来の発動コンテキストがまだないため、常に未対応として拒否します。

## 接続時に守る境界

- applyPlayerIntentに渡せる進行操作はendMain/passBlock/endCounterのみ。actorはsocketの席から決める。
- applySystemEventの各イベントは信頼するサーバー内部用。クライアントのkindやoriginがserverだからといって転送しない。
- checkTimingの許可は必ずscope: timingOnly。カードの条件・コスト・回数・対象を満たす保証ではない。
- phaseWork取得や完了通知だけでカードを動かしたと扱わない。将来の実行器で盤面と進行を同じ確定単位にする。
- resolutionId/selectionId/battleIdはサーバーが対戦内で再利用しない一意IDを生成する。matchIdも通信層で照合する。
- 公開Viewは別途作る。gateにある内部IDや実行コンテキストを、そのまま全員へ送らない。
- JSONへのシリアライズは可能だが、永続化・不正な保存データの検証・再接続復元は未実装。
- ゲーム終了は終端。選択待ち中でも終了通知を処理できるが、勝敗判定は別のルール処理器で行う。

## 未対応と次の実装

現在の対戦画面・自由な手動操作には未接続です。利用者の操作感は変わりません。
手動モードとルール制御モードの境界、ターン開始処理の詳細、効果による例外、同時誘発、期限付きModifier、選択候補、コスト支払いは未実装です。
欠損値をunknownとして扱う参照・Predicate評価器は [条件評価器の設計](predicate-runtime.md) として独立追加しました。現行Match/Progressionから情報を組み立てる接続はまだありません。次は対象選択・支払い・移動の計画を整えたうえで接続へ進めます。

## 検証

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/progression.cjs test/effects-schema.cjs test/effects-types.cjs test/test-game.cjs test/test-lobby.cjs
cd ..
node --test tools/test-card-master.test.js
npm run build
```
