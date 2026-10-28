# 汎用効果エンジン v3 導入記録

## 基準と今回の範囲

2026-10-28に渡されたeffect_engine_v3_codex_spec.mdを今後の基準とします。
添付のJSON例は3.0-draftの設計例であり、実行可能な効果や裁定済みfixtureではありません。
代表18件もNEEDS_MANUAL_RULE_REVIEWであり、正解の状態遷移として自動採用しません。
Phase 1の既存調査・CSV監査・監査用型/Schemaは完了しています。
Phase 2は、以下に記載した限定DSLのCompiler、Registry、承認ゲートまで実装しています。
Phase 3は署名付き解決フレーム、選択待ち・復元、盤面操作要求を出す制御機械まで実装しています。
MovementEngineへ接続するローカル限定のFixtureCoordinatorも追加しています。
ローカル限定のv3専用Socket/画面も接続しています。
v3全命令、レビュー操作画面、正式対戦への接続、実カード効果の実行は未実装です。

## 既存ソースとの対応

| 領域 | 既存実装 | v3で必要な差分 |
| --- | --- | --- |
| 型・検証・Registry | server/src/test/effects/types.ts、registry.ts、validation.ts、builtins.ts | 現行kindベースとv3のtypeベースを明示的に版管理。未知命令は拒否。暗黙変換しない |
| 選択・コスト・移動 | selectionSession.ts、movementSelection.ts、movementCosts.ts、movementActions.ts | 既存権限・不可視情報・原子的支払いを維持し、新計画形式と接続 |
| 対戦所有・通信 | effectMatchOwner.ts、ownedEffectEndpoint.ts、effectSocket.ts | 対戦単位の所有境界、requestIdと両revision、各プレイヤー投影を維持 |
| 進行・参照 | progression/*、movement/* | instanceId/generationの寿命、原因別移動、進行ゲートを再利用検討 |
| 中断・再開 | timedMovement.ts等にサーバー内待機状態、snapshot()に盤面/進行 | 再接続viewと、プロセス再起動を越えるResolutionFrameの保存復元は別。後者は未実装 |
| 置換・継続効果 | DSLにスキーマ上のノードはある | 汎用ReplacementResolver・依存関係付き継続評価が完成済みとは扱わない |
| ローカル検証 | localBattle.ts等 | テストブロック等のフィクスチャを正式なルール実装として流用しない |

通常オンライン、一人回し、現在のマスターJSON、効果ランタイムのロード経路は今回変更しません。
v3監査データはpublic/card-master.jsonへ出力せず、サーバーの起動時にもロードしません。

## 監査コマンド

VS Codeでworkspace_serverを開き、PowerShellのターミナルで次を実行します。
出力先はまだ存在しないフォルダ名にしてください。既存の監査結果は上書きしません。

```powershell
cd C:\Users\kensh\workspace_server
npm run audit:effect-cards -- C:/Users/kensh/Downloads/onepiece_cards_ja.csv C:/Users/kensh/workspace_server/local-data/effect-v3/audit-20261028
```

同じ入力フォルダに、仕様書・DSL例・代表カードJSON・差異CSV・タグCSV・パターン集計CSVの6ファイルが必要です。
別名や別配置は現在未対応です。UTF-8を厳密に読み込み、文字化けを置換文字で見逃しません。
Shift-JIS入力を意図する場合だけ、コマンド末尾にshift_jisを指定できます。参照ファイルはUTF-8です。

生成物はgit管理外のlocal-dataにのみ保存します。

- sources/: 入力CSVと参照6ファイルのコピー。取得URL・取得日を含む原文を保持。
- summary.json: 入力SHA-256、文字コード、参照ファイルのハッシュ、件数と照合結果。
- card-review.json: カード番号別の監査定義と、表示ID/CSV論理レコード番号別の全原文。
- variant-differences.csv/json: フィールド単位の差異と該当レコード番号。
- anomalies.csv: 未知の種類、表示ID重複/欠損、不正数値など。
- tag-observations.json: タグの観測件数。意味解析・実装率ではありません。

レコード番号は複数行フィールドを1件と数え、ヘッダーを1とする番号です。物理的な行番号ではありません。
CSVレポートは表計算ソフトの数式実行を避けるため、=、+、-、@で始まる値にアポストロフィを付けます。
無加工の原文はsources/とcard-review.jsonのrawを参照してください。

## 自動処理の境界

比較用正規化はNFC、改行、空白、‼/!!の揺れのみです。原文は変更しません。
正規化後に一致しても承認はしません。相違が残るフィールドはconsensusから除き、先頭行の値を採用しません。
consensusは監査用の文字列で、承認済みの名称・基本数値・効果定義ではありません。
カード名・特徴・属性の日本語や記号をそのまま保存します。空欄・ハイフンは0にしません。
不明な種類は自動補正せずunsupportedとして隔離します。CSV構造の破損や不正なカード番号は全体を停止します。

監査用Schemaはschemas/effect-v3-review.schema.json、対応する実行時構造検証はcardData.tsです。
相互参照・レコード一意性等は構造検証でも検査します。reviewStatusとparseStatusはneeds_review/unsupportedのみ。
effectsは空配列に限定し、approved指定・未知フィールド・実行ノード混入を拒否します。
requireExecutableV3Cardも必ず拒否します。監査結果をJSONにしただけで効果が使える状態にはなりません。

## 添付データの実測

5,058レコード、2,885カード。原文差異は164のカード番号×項目組です。
添付の163組（テキスト136・名前19・トリガー8）に加え、ST32-001の特徴の差異を検出しました。
比較正規化後も相違が残るのは57組です。残りもレビュー不要という意味ではありません。
P-160の種類「キャラクタークター」を1レコードで検出し、推測でCHARACTERに修正していません。
needs_review 2,884、unsupported 1、parsed 0、approved 0。意味的なカード承認率は0%です。

## 次のPhase

### Phase 2：限定Compilerと承認ゲート

入力版は3.0.0-subset.3、Compiler版はv3-subset-compiler.3です。
旧subset.1/2、添付3.0-draft、既存dslVersion:1を暗黙変換しません。旧版の定義は明示更新と再レビューが必要です。
schemas/effect-v3-subset.schema.jsonは標準組み込み命令の編集用Schemaです。
Compilerは型・未知フィールド・参照先・比較の値型・ID重複・原文範囲・複雑度も検証します。
sourceSpanのstart/endはsource.textのUTF-16コード単位で、endは範囲外終端です。

対応するコンパイル命令：

- timing: MAIN。kindはactivatedのみ。leader/character/stageの自身のゾーンのみ。
- predicate: all / any / not / compare（eq / ne / lt / lte / gt / gte）。
- value ref: SELF/OPPONENTのlifeCount/handCount、SOURCE/CANDIDATEのcost/power/cardType/rotated、選択済みbindingsのcount。自由なJS式や任意プロパティ参照は不可。
- cost: REST_DON（1〜50）。
- action: DRAW / SEQUENCE / IF / SELECT / MOVE_CARD / KO / REST / SET_ACTIVE。
- selector: CARDS（表向き公開カードのみ、SELECT、UNORDERED）。

未対応：自動誘発、イベント、KO時効果の派生実行、非公開領域の選択、BLIND_SELECT/RANDOM/ALL/ORDER、usageLimit、optional、DON_RETURN、付与、期間、置換、継続、CUSTOM_HANDLER等。
未知ノードは読込時に拒否します。schemaOnlyの既存ノードが存在してもv3対応済みとは扱いません。
predicate/action/cost/replacement/selector/duration/timingのRegistryを用意しています。
replacement/durationは登録なしで、現在は到達する効果形式も未対応です。
拡張はTypeScriptのMapインターフェース拡張と、信頼されたサーバーコードによるparser登録で行います。
新しい実行ハンドラーや意味論までJSONから注入することはできません。
Registryはコンパイル時にsealし、重複/後付け登録を拒否します。ハンドラー実装変更時には登録versionを上げます。

CardDefinitionに名称、基本数値（nullと0を区別）、色/特徴/属性、原文、採用表示ID、入力データSHA-256を保持します。
Compilerは正規化した型付きAST、使用命令一覧、定義/原文/Registryのハッシュ、Compiler版を固定します。
この正規化はJSONのキー順等を扱うだけで、原文から効果を推測しません。
結果はcompiled_not_executableであり、承認済みとは別です。

ApprovedV3Catalogの承認記録はサーバーの信頼済み構成として渡します。SocketやカードJSONから受け取る経路はありません。
記録はカードID/版、定義/原文/Registryハッシュ、Compiler版、ruleset版、承認者、日時、裁定根拠を必須にします。
カードJSONのapprovedフラグだけでは許可しません。未承認・改変・古い承認・重複・偽造planは拒否します。
これは承認証跡の整合性確認です。記録に書かれた根拠が正しい公式裁定かを自動判定したり、電子署名を検証したりはしません。
承認者/根拠の真正性は信頼済みサーバー設定の管理責任で、未確認の裁定をapprovedとして登録してはいけません。
受理後もapproved_not_executableです。requireExecutionは盤面へ接続したRuntime未実装として必ず停止します。

```powershell
cd C:\Users\kensh\workspace_server
npm run check:effect-v3 -- server/test/fixtures/v3-main-draw.json
```

上記は架空カードの構造確認のみです。公式カード/裁定のfixtureでも承認データでもありません。
監査2,885カードから自動的にDSLへ変換・承認したカードは0件です。
CLIはコンパイル結果の概要を表示するだけで、入力・マスター・承認記録を書き換えません。

### 公開カード選択とbindings

SELECTはselectorとbindAsを持ちます。selector内へのbindAs重複指定は受け付けません。
CARDSはowner/controller/zone/cardTypes/filters/excludeSource/faceUpOnly/min/max/visibility/selectionMode/chooser/order/onInsufficientをすべて明示します。
選択対象ゾーンはleader/character/stage/trash/publicのみで、faceUpOnly:true、visibility:PUBLICを必須にします。
public等に裏向きカードがあっても選択可能という意味ではありません。Runtime接続時にも可視性を再検証する必要があります。
手札・デッキ・ライフの内容を公開する選択はコンパイルできません。
owner、controller、chooserは別々に定義します。これらは相対プレイヤーであり、クライアントが任意のsocketやplayerIndexを渡すものではありません。

minは0〜max、maxは1〜50。min:0の空選択と、minを満たせない候補不足を区別します。
onInsufficient:failを必須にし、勝手な枚数補正や部分的な支払いを定義しません。
実候補の盤面からの算出は未接続です。選択待ち・応答処理は下記の制御機械に実装しています。

bindAsは英字始まりの英数字/アンダースコア、最大64文字です。
選択済みカード集合は{"ref":"bindings.picked"}、枚数は{"ref":"bindings.picked.count"}で参照します。
SOURCEや枚数をカード集合として扱うこと、未定義/先行参照、自己参照、同一スコープの再定義は拒否します。
SEQUENCEの中では順番に束縛が伝播します。IFは親の束縛を読み取れますが、各枝で追加した束縛は兄弟枝・分岐後へ漏れません。
両方の枝に同名束縛があっても外側へ合流させません。保守的な確定参照の制限です。
効果ごとにスコープを分離し、activationConditions/resolutionConditionsでは後続actionsの選択結果を参照できません。
CANDIDATE参照はselector.filters内のみ有効です。型に合わない比較（cardTypeと数値など）も拒否します。
cost/powerが不明なときの評価を0/falseに置き換えることはせず、実行時のunknown処理はRuntime側で実装します。

MOVE_CARDは束縛済みカード集合を参照し、cause:EFFECTだけを受け付けます。KOやコスト扱いへの偽装はできません。
移動先はhand/trashへ表向きappend、deckへ裏向きtop/bottomだけです。デッキは順序未対応のため、最大1枚の束縛だけを許可します。
参照の寿命/generation、所有権、移動禁止、カード枚数保存等の盤面上の合法性は将来のMovementEngine接続時に別途検証します。
Compiler成功はそれらの合法性検証や公式裁定の承認を意味しません。

```powershell
npm run check:effect-v3 -- server/test/fixtures/v3-select-move.json
```

この合成fixtureも非実在・needs_reviewで、対戦にはロードしません。

### Phase 3：保存可能な制御フレーム

V3ResolutionMachineは承認カタログが同一プロセス内で生成したplanだけを受け付けます。
Compilerと同じ標準Registryハッシュを検証し、独自Registryでコンパイルしたplanを実行ハンドラー対応済みとして扱いません。
現在のmodeはwork_requests_onlyです。これは実盤面へ直接書き込まない、単一効果の制御機械です。
sourceの実在/位置、発動タイミング、手番、盤面ルールの合法性はまだ検証・適用しません。

保存フレームには定義/Compiler/Registry/ruleset版、試合/解決ID、actor/source、pc、スコープ別bindings、
待機中の選択または盤面操作要求、世界revision、フレームrevision、要求レシートを含めます。
SEQUENCE/IF/スコープを固定プログラムへ展開し、Promise・コールバック内の一時変数だけには依存しません。
述語評価・候補算出は信頼済みサーバーの純粋なEnvironmentとして注入します。
盤面由来のEnvironmentは下記FixtureCoordinatorにのみ接続しています。既存対戦のEnvironmentは変更していません。
Environmentのunknownはfalse/0にせず停止し、そのadvance呼出しで変更したフレームを確定しません。

SELECT待ちは2分で期限切れになります。chooserだけへ不透明token/cardIdを送り、他方には候補を送らず、bindingsやrefはどちらのviewにも出しません。
公開候補でもowner/controller/zone/種類/表向き/双方の可視性/重複を再確認します。
actor、selectionId、revision、期限、枚数、token、世界revisionを検証してから回答を適用します。
UNORDERED回答はサーバー候補順に正規化し、クライアントがtokenの並びで移動順を指定することを防ぎます。
期限切れで自動選択・自動キャンセル・コスト返却はしません。期限切れ後の再提示/中止方針はCoordinator側の未実装事項です。

DRAW/MOVE_CARD/REST_DONは盤面操作要求として停止します。REST_DONの複合支払いは1つのPAY_COSTS要求にまとめます。
KO/REST/SET_ACTIVEも同じく盤面操作要求として停止します。これらはcardsに束縛済みカード集合だけを受け付け、クライアントが原因や移動先を上書きすることはできません。
workIdは解決IDとpcから決まり、再送や復元でも変わりません。
workForCoordinatorはサーバー専用APIで、要求の参照情報をSocketへそのまま公開してはいけません。
信頼済みCoordinatorが全件を原子的に処理し、盤面revisionを1つ増やした場合だけsettleWork(applied)で進めます。
失敗時は盤面revisionを変えずsettleWork(rejected)でblockedにします。部分支払いや勝手な次命令へのスキップはしません。
このモジュール自体はカード移動、DONレスト、ドロー、イベント発火、勝敗判定を一切実施しません。

全制御要求はrequestIdとフレームrevisionで冪等性を確認します。内容を変えた再送は拒否し、512件で安全に停止します。
exportForStorageはフレームをHMAC-SHA256署名付きで返します。署名鍵はサーバー側の32〜128byteの秘密値で、フレームとは別管理します。
restoreは同じ承認定義・identity・世界revision・保存先の最新frame revision・署名を検証します。
署名だけでは過去の正しい保存物の再利用を防げないため、最新revisionは別途信頼できる保存先から渡します。
保存物には内部参照とtokenを含みます。API応答に使わず、DB等のサーバー専用保存先だけに置きます。

実DBへの書込み、現行Socketへの接続、起動時の復元処理は今回実装していません。
実装時は盤面・フレーム・workId別適用記録・最新revisionを同一トランザクションで永続化する必要があります。
署名鍵を含む運用構成も未追加です。現行の対戦がサーバー再起動後に復旧できるようになった、という意味ではありません。
盤面操作だけ適用した直後のクラッシュや派生イベント/勝敗の裁定は、この制御機械だけでは解決しません。

### MovementEngineへのローカル限定接続

fixtureCoordinator.tsのV3FixtureCoordinatorはmode:syntheticNoAbilitiesを明示したサーバー内検証専用です。
NODE_ENV=productionでは生成・書込みを拒否します。通常対戦/一人回し/従来のテストルームのSocketには接続していません。
このモードは、選択した合成効果以外の誘発・置換・耐性等が存在しない検証盤面だけを前提にしています。
実カードを一般的に合法処理できるという意味ではありません。

開始時に承認plan、matchId、sourceのinstanceId/generation、所有者/コントローラー/表向き/ゾーン/種類、
mainEffectの合法タイミング、盤面と進行のturn一致を検証します。
修正値/付与能力/一時公開を持つ盤面や空デッキは拒否します。進行ゲートはbeginResolutionでロックします。
選択待ちでwaitForChoice、応答後にacceptChoice、処理完了時だけfinishResolutionを行います。
失敗でblockedになった場合はゲートをロックしたままにし、自動返金や不明な中止処理は行いません。
回復/中止UIは未実装なので、現段階のfixtureは作り直して確認します。

fixtureEnvironment.tsは実際のMovementStateから候補を列挙し、双方の可視性と世代を確認します。
数値は固定した既存マスターのfact、または承認済み定義と同一カードIDの基本値を使います。
承認定義のnullや欠損マスターはunknownです。付与DON付きカードのpower等、未処理の数値もunknownにします。
未知の値を0やfalseに置換しません。all/any/not/compareと型付き参照を評価します。
既存マスターはサーバーが検証用数値の参照元として信頼して渡すもので、CSV原文の自動承認ではありません。

盤面操作は次の限定範囲です。

- PAY_COSTS: REST_DONの合計を先に検証し、ちょうど合計枚数のACTIVE DONをcostトランザクションでレスト。部分支払いはしません。
- DRAW: デッキ先頭から手札へEFFECT_MOVE。相手のviewには手札内容を送りません。
- MOVE_CARD: 現在の世代を再検証し、表向きのcharacter/stage/trash/publicから持ち主の手札/トラッシュ/デッキへ移動。leader/DONの通常エリア移動や他人の所有物化は拒否。
- KO: 表向きのキャラクターエリアのキャラだけを持ち主のトラッシュへ移動し、EFFECT_KO/isKO:trueを記録。通常のMOVE_CARDによる直接トラッシュ移動はEFFECT_MOVE/isKO:falseのまま。
- REST/SET_ACTIVE: 表向きのleader/character/stageのレスト状態をtrue/falseへ絶対指定。すでに指定状態なら切り替えず、世代も変えません。DONレスト支払いとは別命令です。
- キャラ退出時の付与DON戻しは既存MovementEngineの自動処理を使用。
- デッキが空になる/不足するドローは、勝敗・派生イベントのポリシー未実装として盤面を変更せずblocked。正式なデッキ切れ裁定の実装ではありません。

操作ごとにMovementStoreで候補盤面を作り、フレームのsettleWork、進行ゲートまで成功してからまとめてメモリに保持します。
トランザクションIDはmatchId/workIdのハッシュで固定し、同一要求の再送は盤面を再適用しません。
書込み要求にはframe/movement/progressionの3つのrevisionとrequestIdを使います。別プレイヤー・古いコンテキスト・変更された再送を拒否します。
MovementEventは原因・isKO・付与DONの自動戻しを含めてサーバー内部に保持し、上限512件で停止します。
イベント順序を公式の効果解決順とは解釈せず、まだ誘発をスケジュールしません。直接バウンスをKO扱いにすることもありません。
KO後の古いgenerationの束縛は、次の操作で別オブジェクトとして再利用せず拒否します。
KOされない耐性・置換・KO時能力等のある実カードへの適用は未対応です。このfixtureはそれらが存在しない前提だけで検証します。

viewForは公開投影のみです。snapshotForCoordinatorは原盤面・進行・署名付きフレーム・レシート・内部イベントを含むサーバー専用APIで、クライアントへ送信してはいけません。
DB保存、Coordinator全体の再起動時復元、署名鍵の運用構成、分散ロック、既存Matchへの反映は未実装です。
メモリ内の1操作の原子性を確認した段階であり、サーバー停止を越えた永続化や再接続を保証するものではありません。

### v3の2ブラウザー検証

1. VS Codeでworkspace_serverを開き、新しいPowerShellターミナルを用意します。
2. 次を実行します。既存のdev:effectsとは別のモードです。

```powershell
cd C:\Users\kensh\workspace_server
npm run dev:effects-v3
```

3. `V3 LOCAL SYNTHETIC FIXTURE ONLY`とViteのLocal URLを確認します。通常はhttp://127.0.0.1:5190/です。使用中ならViteが選んだ別ポートのURLを使います。
4. Local URLを2つのブラウザーウィンドウで開きます。Vercelの公開URLでは動きません。
5. 各ウィンドウのトップで画像ZIPと保存デッキを用意します。別ポートの保存デッキは自動で引き継がれないので、必要なら保存済みデッキを読み込み直します。
6. 両者ともトップの「テスト対戦」を押します。「v3ローカル検証」が表示されることを確認します。
7. 一方でルーム作成、他方で4桁コードを入力して入室します。
8. 両者でデッキを選択し、READYを押します。リーダー1枚・メイン50枚・DON10枚で、メインにキャラが2枚以上あるデッキを使います。
9. ホストが「合成効果」と「操作者」を選び、「検証開始」を押します。

開始時に両側へ公開キャラ2枚・ACTIVE DON2枚を配置します。マリガンや本来の対戦開始手順ではありません。
「自分のキャラをアクティブ」のケースだけ、操作者側のキャラ2枚を最初からレストにします。
初期手札やライフにキャラが偏った場合は、デッキとの入替えで枚数を保ってテスト用の場を準備します。
リーダーはサーバー内部でV3-FIXTURE-LEADER-0/1という架空IDへ置き換え、画像表示だけ選んだデッキのリーダーを使います。
元の実カード番号で能力を自動承認することはしません。実カードの画像・印刷テキストが見えても、その効果を実行するモードではありません。

「公開キャラ → 手札」では、操作者の「処理を進める」→カードを0〜1枚選択→「選択を確定」→「処理を進める」→「カードを移動」→「処理を進める」で完了します。
0枚選択の場合は移動要求がないため、途中で処理完了になります。
「DONレスト → ドロー」では、「処理を進める」→「支払いを確定」→「処理を進める」→「ドローを実行」→「処理を進める」で完了します。
「相手キャラをKO」「相手キャラをレスト」「自分のキャラをアクティブ」も、選択→処理を進める→対象の処理ボタン→処理を進める、で確認できます。
KOは相手の場から相手のトラッシュへ、レストは相手キャラを横向きへ、アクティブ化は自分のレストキャラを縦向きへ更新します。
相手側の画面にも同じ公開盤面が同期されます。実カードの能力・発動条件を再現するものではありません。
他方ではカード候補や増えた手札の内容を見られず、公開盤面と枚数だけ更新されます。
「盤面を見る」でパネルを小さくできます。カードの詳細表示は従来のTestBoardを使用します。

ホストの「ルームへ戻る」で同じ部屋へ戻ります。両者READY後に操作者/ケースを変えて確認できます。
ゲスト退出/切断では検証セッションを破棄し、ホストはルームに残ります。ホスト退出/切断では部屋を解散します。
応答不明時は操作を止め「再同期」を押します。期限切れ/blocked時は、ホストがルームへ戻して検証を開始し直してください。
再接続による試合復旧・自動ターン交代・通常の自由移動・バトル全体はこのモードに含めません。

実装上はv3専用プロトコルとloopback専用サーバーを使用します。CORS/SocketハンドシェイクのOriginをlocalhost/127.0.0.1に制限します。
Socketのactorはサーバーの所属情報から決め、両者接続・要求形式・3つのrevision・requestIdを確認します。
クライアントからactor/移動カード/実行JSONを指定する要求や、未知フィールドは拒否します。60要求/10秒の上限を設けています。
最新の試合IDとrevisionを照合して、退出後の応答や古い盤面で新しい盤面を上書きしないようにします。
ViteのDEVかつ専用フラグが有効な場合だけ新しい画面を表示し、従来のdev:effectsと公開ビルドは従来画面のままです。

### 続く開発

Phase 2の残りでは、非公開選択や順序選択等のCompiler対応を、実行可能な範囲と分けて拡充します。既存のkind形式は別版のまま維持します。
今後は検証結果を見て、承認済み定義の読込や対象範囲・イベント/置換処理を段階的に拡張します。正式対戦への自動切替や、未承認の実カードへの適用はしません。
Phase 4以降に置換・継続・バトル統合を進めます。
同時誘発の順序、複数置換の選択、勝敗チェックの位置、トリガー機会、KO誘発時点、継続効果の循環等は
RulesetPolicyとして根拠と確認状態を保持し、未確認の組合せでは停止する設計とします。今回は裁定を確定していません。

```powershell
npm --prefix server run build
node --test server/test/v3-compiler.cjs server/test/v3-selection-compiler.cjs server/test/v3-resolution.cjs server/test/v3-fixture-coordinator.cjs
node --test server/test/v3-local-server.cjs
node --test tools/test-v3-fixture-client.test.js
node --test tools/audit-effect-cards.test.js tools/test-card-master.test.js
npm run build
```
