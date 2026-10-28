# 起動効果と進行管理の接続

`server/src/test/effects/timedMovement.ts` のTimedMovementEffectが、独立したMovementと
Progressionの両方を所有し、起動タイミング・支払い・選択待ち・解決終了を連動させます。
既存Match、Socket.IO、対戦画面、通常対戦、一人回しには未接続です。

## 対象と限界

- 盤面上の自分のleader/character/stageを発動元とするactivate main/counter定義だけが対象です。
- mainは手番側のmainチェックポイント完了後、counterは防御側のcounter判断中だけ許可します。
- trigger、onPlay/onAttack/onKo等の誘発、手札イベントの使用・解決領域移動はまだ拒否します。
- 現行ProgressionのcheckTimingを利用します。独自のカードルールを追加していません。
- これはタイミング確認とDSL conditionの評価であり、発動禁止・回数制限・カード固有条件の
  網羅的な合法性検証ではありません。未モデル化の制限は将来の呼出し側が検証する必要があります。
- 引数は信頼するサーバー内部用です。保存JSONやクライアントから直接復元するAPIではありません。

## 呼出し

1. 盤面と進行状態、サーバー発行のidentity、検証する定義を渡して生成します。
2. start(actor, { movement, progression }, rules)で発動します。
3. advanceで次の命令へ進め、選択待ちならselectionViewForを選択者だけへ送ります。
4. answerSelection(actor, revisions, reply, rules)で回答します。

actorは認証済みsocketの席から決め、定義やsourceもサーバーの登録情報を使います。
両revisionが必要です。MovementとProgressionは別のrevision列なので混同しません。
通常のstart/advanceは効果controllerだけ、回答はgateに記録したchooserだけが可能です。
SOURCE/TARGETや候補の内容は既存SelectionSessionで再検証します。

## 支払いとゲートの一貫性

start時はタイミングを確認し、beginResolution後の進行状態を一旦仮作成します。
実行器がトップレベルconditionを評価してからDONを支払います。不成立・unknown・
支払い失敗なら、両方の状態を元のまま維持します。効果処理は開始しません。
成功後のみ、盤面と新しい進行状態の組を公開します。

選択待ちではgateをchoiceにし、resolutionId/selectionId/chooserを一致させます。
不正回答は盤面・進行とも変更しません。正常回答はacceptChoice後に解決を再開し、
最終命令ならfinishResolutionでidleへ戻します。選択中のフェーズ移行等は既存gateが拒否します。

効果実行失敗では支払いを戻さず、gateをresolvingのまま維持します。
正常回答が受理された後に盤面確定が失敗した場合も、回答済みのchoiceへは戻さず、
blockedな解決としてロックを保持します。自動再試行・解除・返金APIは追加していません。

全処理は同期的で再入を拒否します。内部のMovementを他の可変Matchと並行運用してはいけません。
進行revisionの上限到達で支払いだけ確定しないよう、開始時に最大258遷移の余裕を確認します。
snapshotはサーバー専用の完全状態です。公開投影なしに全員へ送信してはいけません。

## 条件のFacts

PreparedMovementEffectでもトップレベルconditionを支払い前に評価します。
TimedMovementEffectは所有するProgressionのactivePlayer/phase/turnNumberを渡し、
発動条件・後続if・Selectorの条件が同じ手番情報を参照します。
Progressionを渡さない旧来の単独実行器では、activePlayer/phaseは引き続きunknownです。
既存MasterFactsの欠損値・数値補正の安全方針もそのまま適用します。

## 検証

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/timed-effect.cjs test/action-cost.cjs test/action-control.cjs test/action-selection.cjs
```
