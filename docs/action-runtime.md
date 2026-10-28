# DSL命令の移動実行器（第1段階）

`server/src/test/effects/movementActions.ts` の `PreparedMovementEffect` は、
検証したDSL命令を独立Movementモデルで実行します。既存サーバー・対戦画面には未接続です。
通常対戦、一人回し、カードマスター、通信プロトコルは変更しません。

## 今回実行できる命令

- `draw`: 指定側の山札の先頭から手札へ移動。相手側の指定もSELF基準で処理します。
- `move`: 先行命令のカード集合変数から移動。原因はEFFECT_MOVEのみ。
- `sequence`: 順次実行。同じ変数スコープを引き継ぎます。
- `repeat`: 固定回数の繰り返し。反復ごとに独立した子スコープを作ります。

移動後のsaveAsには、実際に移動したカードの新しいgenerationを保存します。
移動を防止されたカードや、付与DONの自動返却は、その命令の結果集合へ混入しません。

## 呼出し契約

このAPIは信頼するサーバー専用です。クライアントから定義・ルール判定・actorを直接渡しません。
将来のMatch管理側が発動タイミング、優先権、効果の利用権限を検証してから生成します。
コンストラクターでも定義を再検証・コピーし、発動元のカードID・generation・controllerを確認します。

1. コンストラクターで全命令を事前検査。未対応命令は0回反復内でも拒否します。
2. `start(revision, rules)` でコストなしの解決を開始します。
3. `advance(revision, rules)` で末端命令を1個ずつ実行します。
4. 全命令の完了時にcompletedへ遷移します。

古いrevision、再送、再入を拒否します。命令内の移動は一括確定します。
後続命令で失敗した場合はblockedとなり、それ以前に確定した命令を巻き戻しません。
snapshotと実行結果は非公開サーバーデータです。送信には既存Movement投影が必須です。

## 明示的な未対応

- コストあり、conditionありの定義（支払い前に拒否）
- select、if、optional、modify、耐性、置換の設置と誘発待機
- 複数カードの山札上への移動順序（推測せず停止）
- 山札不足時の部分ドローや敗北判定（推測せず停止）
- CostPlan/Selector/Progressionとの接続、通信待機、保存・再接続

ドローは1命令最大64枚、展開後の末端命令は最大128個です。
構造検証の既存上限とMovementの操作・イベント上限も有効です。
`certifiedNone` は関連ルールがないことを信頼する呼出し元が確認した場合に限ります。
実カードの効果は登録しておらず、この実装だけで自動対戦はまだできません。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/movement-actions.cjs test/resolution.cjs
```
