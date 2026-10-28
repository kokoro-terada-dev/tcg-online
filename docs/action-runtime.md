# DSL命令の移動実行器（第1段階）

`server/src/test/effects/movementActions.ts` の `PreparedMovementEffect` は、
検証したDSL命令を独立Movementモデルで実行します。既存サーバー・対戦画面には未接続です。
通常対戦、一人回し、カードマスター、通信プロトコルは変更しません。

## 今回実行できる命令

- `draw`: 指定側の山札の先頭から手札へ移動。相手側の指定もSELF基準で処理します。
- `move`: 先行命令のカード集合変数から移動。原因はEFFECT_MOVEのみ。
- `sequence`: 順次実行。同じ変数スコープを引き継ぎます。
- `repeat`: 固定回数の繰り返し。反復ごとに独立した子スコープを作ります。
- `select`: 既存SelectionSessionでカード・選択肢を選び、結果を変数へ保存します。
- `if`: 実行時点のFactsで条件を評価し、then/elseの一方だけを実行します。
- `optional`: 指定側が「使う／使わない」を選択し、使う場合だけ子命令を実行します。

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

## 選択待ちと再開

手動選択ではadvanceが `{ kind: "selectionPending" }` を返し、表示状態が
waitingForSelectionになります。この段階では盤面revisionは増えません。
`selectionViewFor(viewer)` は選択者だけに不透明トークン付きの選択Viewを返します。
非選択者にはnullを返し、詳細な候補や非公開カード情報を送信しません。

`answerSelection(actor, reply, rules)` は選択者・matchId・resolutionId・selectionId・revision・
カード世代・位置・候補条件を再検証します。正常回答を確定するとrevisionが増え、
次のadvanceで後続命令へ進めます。待機中のadvanceや回答再送は拒否します。
誤った回答は修正できますが、正常回答の確定に失敗した場合はblockedになります。

ALL/RANDOMは回答待ちせずサーバー内で確定します。ORDERは回答順を保持します。
choiceの結果はoptionIdの文字列として条件式から参照できます。

## 条件分岐・任意効果

if自身の確定も1ステップとしてrevisionが増えます。条件は、その時点の盤面と
スコープ内のchoice変数から既存Predicate評価器で評価します。unknownの場合は
elseに進めずblockedにします。カード集合を文字列や枚数へ暗黙変換しません。

optionalは既存SelectionSessionの不透明な選択肢トークンで回答します。
指定側だけが回答でき、使わない場合は子命令全体を飛ばします。
任意効果を断る操作は解決全体のキャンセルや支払いの返却ではありません。
then/else/optional内の変数は外へ漏れず、親の変数は子から参照できます。
repeatごとの分岐判断と回答IDは独立です。

実行しない分岐も構造・対応命令・上限を事前検査します。
両分岐を含む展開後命令数は最大128個とし、条件評価にも累積予算を設けます。
分岐選択後は選ばなかった命令を実行せず、カード移動イベントも作成しません。

候補Snapshotは実行器自身の盤面から作成し、外部から別の盤面を注入しません。
Movementが保持する種別・レスト・領域・枚数・ターン番号をFactsにします。
任意の第4引数で、サーバーが読み込んだMasterSnapshotを接続できます（下記参照）。
選択で新しい公開権限を作らず、既存の公開状態・一時公開権限だけを利用します。
ブラインド選択はカード名や実体IDを公開せず、隠し情報による絞り込み権限も付与しません。

## カードマスター参照

`new PreparedMovementEffect(state, identity, definition, { master, numericPolicy })`
で、既存parseMaster/loadMasterのSnapshotを渡します。ファイルの再読込は行いません。
この接続は信頼するサーバー専用であり、クライアントのカード情報を採用しません。
解決生成時に対戦内カードだけをコピーして版を固定します。以後、外部のマスター変更は
進行中の判定へ影響しません。表示状態のmasterVersionで使用版を識別できます。

- カード名・種別・特徴・属性・色をSOURCE/TARGETのFactsに追加します。
- effectIdsは効果定義へのリンクであり、キーワード能力abilitiesには転用しません。
- マスターなし・IDなし・数値のnull/欠落はunknownです。0は有効な数値です。
- 既存読込時に特徴・属性・色の項目有無も別保存します。未定義と明示的な空配列を区別します。
- 項目有無がない旧Snapshotは、リスト値を不明として扱います。
- Movementの種別とマスターの種別が矛盾する場合、解決開始前に拒否します。
- SnapshotとFactsは非公開データです。選択Viewへ追加のマスター情報を混入させません。

印刷パワー/コストと現在値を混同しないため、numericPolicyの既定値はunresolvedです。
この場合、数値Factsは不明です。信頼する呼出し元が未モデル化の補正がないことを確認して
certifiedUnmodifiedを指定した場合だけ、印刷値を数値Factsとして使用できます。
それでもmodifierIds/grantIdsがあるカードは数値を不明とし、付与DONがあるカードの
現在パワーも不明とします。付与DONだけではコストの参照を妨げません。
全ての継続効果・補正・手番を含む現在値計算器はまだ実装していません。
将来のMatch管理側で未補正と保証できない場合、certifiedUnmodifiedを指定してはいけません。

古いrevision、再送、再入を拒否します。命令内の移動は一括確定します。
後続命令で失敗した場合はblockedとなり、それ以前に確定した命令を巻き戻しません。
snapshotと実行結果は非公開サーバーデータです。送信には既存Movement投影が必須です。

## 明示的な未対応

- コストあり、conditionありの定義（支払い前に拒否）
- modify、耐性、置換の設置と誘発待機
- 複数カードの山札上への移動順序（推測せず停止）
- 山札不足時の部分ドローや敗北判定（推測せず停止）
- CostPlan/Progressionとの接続、完全な現在値計算、Socket通信、保存・再接続

ドローは1命令最大64枚、展開後の末端命令は最大128個です。
構造検証の既存上限とMovementの操作・イベント上限も有効です。
`certifiedNone` は関連ルールがないことを信頼する呼出し元が確認した場合に限ります。
実カードの効果は登録しておらず、この実装だけで自動対戦はまだできません。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/master-facts.cjs test/action-control.cjs test/action-selection.cjs test/movement-actions.cjs test/resolution.cjs
```
