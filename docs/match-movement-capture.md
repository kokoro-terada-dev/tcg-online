# 既存Matchから効果用盤面への読み取り変換

MatchMovementCaptureは既存テスト対戦のMatchを検査し、独立MovementStateを作ります。
server.tsやgame.tsの動作は変更せず、既存ルーム・UI・通信へはまだ登録しません。

## 変換

- UUID、カードID、所有側、並び順、空き枠、表裏、レストを引き継ぎます。
- DONデッキの内部表裏だけMovement仕様の裏向きにします。公開投影では従来どおり見えます。
- 元Matchを変更せず、別のfreeze済み盤面を返します。
- generationは移行開始の0、Movementのrevisionと取引履歴も0/空から開始します。
- 元のrevisionはlegacyRevisionへ別保存し、Movementの取引履歴と混同しません。
- ターン番号は信頼するサーバーが明示します。手番・フェーズをカード配置から推測しません。
- 登場ターンは不明なのでnullです。取り込んだキャラクターを今ターン登場した扱いにはしません。
- 旧Matchにない付与DON・補正・付与効果のデータを生成しません。

## 使用と競合検出

```typescript
const capture = new MatchMovementCapture(match, authoritativeTurnNumber);
const { movement, legacyRevision } = capture.snapshot();
capture.assertCurrent(match);
```

assertCurrentは元Matchの同一性、revision、全カード・順序・枠・攻撃状態・再送履歴、
マスターの同一性と版を照合します。同じrevisionのまま書き換えた場合も拒否します。
異なるMatchや更新済みの旧Matchへ、効果処理を黙って上書きするためのAPIではありません。

この部品は競合検出であり、排他ロックではありません。既存applyCommandを直接呼ぶ経路を
止めるものではありません。現行Matchへ組み込む際は対戦単位の所有者を作り、取り込みから
効果処理終了まで旧手動操作を止める必要があります。古いsnapshotと新しいMatchの並行運用は禁止です。

攻撃中の旧Matchから正確な自動バトル進行を復元する処理は未実装なので、取り込みを拒否します。
未知のカード項目・重複UUID・壊れた枠・不正な表裏等は、情報を捨てたり修復したりせず拒否します。
マスターは既存ローダーによる固定Snapshotまたはnullが必要です。

## 未対応

既存Matchへの書き戻しはありません。旧モデルはgenerationや付与効果を持たないため、
単純な書き戻しでは効果用の参照と状態が失われます。次の接続段階で、Movementを正式な
盤面として所有する管理層と、現行画面用View・手動操作との境界を設計します。
snapshot本体とCapture本体はサーバー専用です。送信にはMovementの公開投影を使います。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/match-movement.cjs
```
