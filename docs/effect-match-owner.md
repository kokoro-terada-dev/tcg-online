# テストMatchの盤面所有者

EffectMatchOwnerは、既存Matchと自動効果用Movementの同時書込みを避けるための
サーバー内部の所有者です。現行ルーム/server.ts/Socket/UIにはまだ登録していません。

## Socket用の入口

OwnedEffectEndpoint(owner)をサーバーで1個作り、bindEffectSocketのresolverが返すhostに指定できます。
この入口は効果が切り替わっても同じオブジェクトを保ち、所有者の競合検証を通して操作します。
内部の効果ごとのHostを取得して直接Socketへ渡してはいけません。
実Matchから取り込んだ盤面で、連続する効果を実Socket越しに処理するテストを追加しました。
現行ルームへの登録や画面側の送信処理は未接続です。

効果間でactiveがない場合、終了済み、競合停止時はnot_availableとしてViewを返しません。
新しい効果がopenされた後はsyncで最新resolutionIdとViewを取得します。
現段階ではサーバー側open/finish/closeの通知を自動配信しません。
この入口もサーバー専用で、シリアライズは禁止です。

## 移行と所有権

- 最初はlegacyです。applyLegacyCommandだけが従来のapplyCommandへ操作を渡します。
- adopt(progression)は、信頼する管理層から渡されたmainの完了チェックポイントでのみ可能です。
- MatchMovementCaptureで取り込んだMovementを正式な盤面として所有し、automatedへ移行します。
- 移行後、旧手動操作の入口は永久に拒否します。旧Matchへの書き戻しやlegacyへの復帰はありません。
- 旧Matchは競合検出用の基準として保持し、効果によって書き換えません。

ルーム管理層は全手動操作をこの所有者へ通す必要があります。既存applyCommandの直接呼出しを
自動的に差し替える部品ではありません。旧経路が直接書き込んだ場合は前後の照合で検出して
faultedへ移行し、操作・公開Viewを停止します。既に確定した効果状態は保持し、勝手に返金しません。

## 連続する効果

openEffect(identity, definition, rules, numericPolicy?)は信頼するサーバー専用です。
定義・source・actor・resolutionIdをクライアント入力から採用してはいけません。
マスターは元Matchの固定Snapshotを使用し、別のマスターへの差替えは受け付けません。

handleEffect(actor, command)で既存受付処理へ操作を渡し、effectViewFor(viewer)で個別Viewを取得します。
実行器/Hostの本体は外へ公開せず、所有者の照合を迂回して書き込む経路を作りません。
正常に完了しgateがidleの場合だけfinishEffectで次の効果を受け付けられる状態に戻します。
Movementのカード世代・取引履歴・revisionとProgressionをそのまま次の効果へ引き継ぎます。

未発動のprepared/idleだけはdiscardPreparedEffectで破棄できます。選択中・支払い済み・
blockedな効果を強制完了/破棄することはできません。resolutionIdは破棄したものも再利用しません。
保持するIDは最大1024件で、古いIDを削除して再送防止を失うことはありません。
古い効果のコマンドは、新しい効果のcontext検証で拒否します。

closeはルーム管理層の終了処理用です。以降の操作と公開Viewを停止しますが、
サーバー診断用の最新snapshotは保持します。支払いを戻す操作ではありません。
snapshot本体と所有者は非公開です。クライアントへシリアライズしてはいけません。

## 未対応

- 既存ルームへの所有者登録、全手動経路の切替え、Socket resolverとの接続
- 登録済み定義からの効果一覧・発動元選択
- ターン開始処理・通常移動・バトルを含む自動モード全体の操作管理
- 現行画面用のView変換、再接続本人確認、保存・復元

この段階はmain中の独立した連続効果までです。adoptしただけで通常対戦が全自動になるものではありません。
所有者を導入しない既存の手動対戦・一人回しは変更していません。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/effect-match-owner.cjs
```
