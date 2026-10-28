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

入力版は3.0.0-subset.9、Compiler版はv3-subset-compiler.9です。
旧subset.1/2/3/4/5/6/7/8、添付3.0-draft、既存dslVersion:1を暗黙変換しません。旧版の定義は明示更新と再レビューが必要です。
schemas/effect-v3-subset.schema.jsonは標準組み込み命令の編集用Schemaです。
Compilerは型・未知フィールド・参照先・比較の値型・ID重複・原文範囲・複雑度も検証します。
sourceSpanのstart/endはsource.textのUTF-16コード単位で、endは範囲外終端です。

対応するコンパイル命令：

- timing: MAIN。kindはactivatedのみ。leader/character/stageの自身のゾーンのみ。
- optional: true/falseを明示。trueは発動条件確認後、コスト選択前に操作者へ確認を出し、辞退なら何も支払わず終了します。
- predicate: all / any / not / compare（eq / ne / lt / lte / gt / gte）。
- value ref: SELF/OPPONENTのlifeCount/handCount、SOURCE/CANDIDATEのcost/power/cardType/rotated、選択済みbindingsのcount。自由なJS式や任意プロパティ参照は不可。
- cost: REST_DON / DISCARD_HAND（各1〜50、DISCARD_HANDは効果単位の合計も50以下）、REST_SOURCE（引数なし、効果単位で1回のみ）。
- cost: DON_RETURN（count:1〜50、from:activeDon/restDon/attachedDonの単一指定または重複しない配列、効果単位で1命令）。fromはCompiler内で配列へ正規化します。
- action: DRAW / SEQUENCE / IF / SELECT / MOVE_CARD / KO / REST / SET_ACTIVE。
- selector: CARDS（表向き公開カード、または本人が選ぶ自分の手札。SELECT、UNORDERED）。

未対応：自動誘発、イベント、KO時効果の派生実行、相手の手札/デッキ/ライフの選択、BLIND_SELECT/RANDOM/ALL/ORDER、DISCARD_HAND/DON_RETURN以外の選択付きコスト、usageLimit、効果途中の任意分岐、付与、期間、置換、継続、CUSTOM_HANDLER等。
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
公開選択の対象ゾーンはleader/character/stage/trash/publicで、faceUpOnly:true、visibility:PUBLICを必須にします。
public等に裏向きカードがあっても選択可能という意味ではありません。Runtime接続時にも可視性を再検証する必要があります。
手札を公開する選択や、デッキ・ライフの選択はコンパイルできません。
本人の手札選択だけはzone:hand、visibility:OWNER_ONLY、faceUpOnly:false、owner/controller/chooser:SELFの組合せで受け付けます。
OWNER_ONLYを他ゾーンへ付けたり、owner/controller/chooserのいずれかをOPPONENTに変えたりすることはできません。
手札の実データが裏向きでも、本人への可視性が確認できれば候補にします。選択のためにカード自体を表向きへ変更しません。
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
OWNER_ONLYでは手札であること、actorと所有者/コントローラーの一致、本人だけへの可視性を再確認します。
相手側の候補配列は空のままで、手札の実IDやトークンも送信しません。
actor、selectionId、revision、期限、枚数、token、世界revisionを検証してから回答を適用します。
UNORDERED回答はサーバー候補順に正規化し、クライアントがtokenの並びで移動順を指定することを防ぎます。
期限切れで自動選択・自動キャンセル・コスト返却はしません。期限切れ後の再提示/中止方針はCoordinator側の未実装事項です。

DRAW/MOVE_CARD/REST_DONは盤面操作要求として停止します。REST_DONとDISCARD_HANDの複合支払いは1つのPAY_COSTS要求にまとめます。
REST_SOURCEも同じPAY_COSTSにまとめ、発動元のleader/character/stageが表向き・本人所有/コントロール・アクティブであることを確認します。
発動元がすでにレストなら支払えず、ほかのDONや手札も変更しません。REST_SOURCE単独でも事前確認が必要で、カード選択は開きません。
count・対象指定・重複したREST_SOURCEはコンパイル時に拒否します。通常のREST効果とは異なり、すでにレスト中のカードを支払い済み扱いにはしません。
DISCARD_HANDは自分の手札のcharacter/stage/eventだけを、合計枚数ちょうど選びます。種類等の追加フィルター・bindAs・任意支払い・取消しには未対応です。
全コストの実行可能性を選択前と支払い要求前に確認し、不足ならblocked、unknownならそのadvanceを確定せず停止します。
選択確定は支払計画の保存だけで、DONも手札もまだ変更しません。支払い時にも全参照を再検証します。
同種のDISCARD_HANDは合算します。この限定fixtureの合算処理を、実カードのコスト選択順の公式裁定とは解釈しません。
保存フレーム版はv3-frame.6で、選択済みcostCards/costReturnedと支払い済みpaidCostWorkId、候補のゾーン/表示ラベル/返却可能なアクティブDON上限、任意発動の確認結果activationDecision、確定済みかを表すactivationCommittedを含みます。旧フレームは暗黙復元しません。
DON_RETURNはfromで指定した自分の公開DONから、指定枚数ちょうど選びます。複数ゾーンを配列指定して混在選択できます。
CARDSも自分のactiveDon/restDon/attachedDonをdon型限定で選択可能で、zoneは単一指定または同じDONゾーン配列を受け付けます。
複合コストはこのfixtureでは手札→DONの順に選択し、最後にPAY_COSTSで一括確定します。JSONの配列順を公式のコスト選択順とはみなしません。
DON返却候補とtokenは操作者だけに送ります。返却枚数とREST_DONを合わせてアクティブDONが足りるかも事前確認します。
支払可能性は、返却候補総数に加えて、レスト支払い用のアクティブDONを確保した上で返却枚数を選べるか確認します。
選択画面では候補ごとにアクティブ/レスト/付与元の場所を表示し、アクティブDONの返却上限を超える追加選択を無効にします。
サーバーも回答時に上限と支払計画全体を再確認します。不正な回答ではフレーム/revision/盤面を変えず選択待ちを維持し、同じselectionIdで選び直せます。
候補ラベル・ゾーン・tokenは操作者だけに送ります。返却上限は公開DON枚数と承認コストから導く値で、選択内容ではありません。
複数DON_RETURN、返却順指定、同じDONのレスト後返却を1コスト内で行う定義は未対応です。特殊なDON能力や公式のコスト順序を推測して適用しません。
KO/REST/SET_ACTIVEも同じく盤面操作要求として停止します。これらはcardsに束縛済みカード集合だけを受け付け、クライアントが原因や移動先を上書きすることはできません。
workIdは解決IDとpcから決まり、再送や復元でも変わりません。
workForCoordinatorはサーバー専用APIで、要求の参照情報をSocketへそのまま公開してはいけません。
信頼済みCoordinatorが全件を原子的に処理し、盤面revisionを1つ増やした場合だけsettleWork(applied)で進めます。
失敗時は盤面revisionを変えずsettleWork(rejected)でblockedにします。部分支払いや勝手な次命令へのスキップはしません。
このモジュール自体はカード移動、DONレスト、ドロー、イベント発火、勝敗判定を一切実施しません。

optional:trueでは、発動条件を確認してからpurpose:activationの専用選択待ちを保存します。これはカード対象選択ではなく、発動前の確認です。
操作者だけに「発動する」「発動しない」の不透明tokenを送ります。相手にはoptionsを送らず、どちらかが確定した後のactivationDecisionだけ両者に公開します。
辞退するとcompletedになり、Coordinatorは進行ゲートを解放します。盤面・イベント・DON・手札は変更しません。
承認しただけでは支払い・移動・正式な発動イベントは発生しません。次のadvanceでコストの実行可能性を確認し、必要な選択と一括支払いへ進みます。
コスト不足ではblocked、unknownではそのadvanceを確定せず停止します。発動可能性の事前保証や、支払い後の取消しを実装したものではありません。
確認待ちも通常選択と同じ2分期限・actor/token/revision検証・冪等性・署名付き復元を使い、期限切れで承認/辞退を自動決定しません。
optional:falseには確認画面を追加しません。必須効果をクライアント指定で任意化することもできません。

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

- PAY_COSTS: REST_DONとDISCARD_HANDの合計を先に検証。ちょうど合計枚数のACTIVE DONをレストし、選択手札を表向きで自分のトラッシュへ、同じcostトランザクションで移動します。全イベントの原因はCOST_PAYMENTで、部分支払いはしません。
- PAY_COSTSのREST_SOURCE: 発動元の世代・位置・可視性・所有者・コントローラー・アクティブ状態を再確認してレスト。同じトランザクションでDON/手札も支払い、発動元の世代は変えません。全操作の合計は64以下です。
- PAY_COSTSのDON_RETURN: 選択DONの世代・元ゾーン・所有者・コントローラー・双方への可視性を再確認してDONデッキ下へ裏向きで戻します。付与は解除、レスト状態も解除し世代は増やします。返却対象をREST_DONの自動選択から除外し、二重使用しません。
- DRAW: デッキ先頭から手札へEFFECT_MOVE。相手のviewには手札内容を送りません。
- MOVE_CARD: 現在の世代を再検証し、表向きのcharacter/stage/trash/publicから持ち主の手札/トラッシュ/デッキへ移動。leader/DONの通常エリア移動や他人の所有物化は拒否。
- MOVE_CARDの自分の手札からの移動: actorの所有/コントロールと本人だけへの可視性を確認し、選択したカードを移動。相手の手札からは移動不可。
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
「手札を捨ててドロー」では、自分だけに見える手札候補から必ず1枚選択します。選択確定だけではまだ公開・移動しません。
「処理を進める」→「カードを移動」で、そのカードだけ表向きのトラッシュへ移動します。
さらに「処理を進める」→「ドローを実行」→「処理を進める」で完了します。手札は5→4→5枚になり、引いたカードは相手には見えません。
これはEFFECT_MOVEによる手札破棄で、COST_PAYMENTではありません。DONも支払いません。
手札を捨てることをコストとして扱うケースは、次の別ケースで確認します。
手札が足りない場合は停止し、勝手に0枚を選んでドローへ進むことはしません。

同じ構文を確認する、非実在・未承認のJSON例も用意しています。

```powershell
npm run check:effect-v3 -- server/test/fixtures/v3-hand-discard-draw.json
```

「DON・手札コストでドロー」はREST_DON 1枚 + DISCARD_HAND 1枚を支払って1枚引く合成ケースです。
「処理を進める」→自分の手札を1枚選択→「支払いカードを確定」→「処理を進める」までは盤面を変更しません。
次の「支払いを確定」で手札とDONを同時に支払い、「処理を進める」→「ドローを実行」→「処理を進める」で完了します。
相手には支払い確定前の手札候補や選択内容を送らず、確定後のトラッシュと枚数だけ公開します。再送で二重支払いしません。
どちらかが不足したら一部だけ支払わず停止し、支払い後の解決条件不成立では勝手に返金しません。
サーバー再起動後のCoordinator全体の復旧や正式な発動取消しポリシーは、引き続き未対応です。

```powershell
npm run check:effect-v3 -- server/test/fixtures/v3-discard-cost-draw.json
```

「発動元レスト・DON・手札でドロー」は、上記にREST_SOURCEを加えた合成ケースです。
同じ手順で支払い確定すると、操作者のリーダー・DON1枚が同時にレストし、手札1枚がトラッシュへ移動します。
両画面のリーダーの向きと公開枚数は同期します。実カードの能力や発動可能性を自動承認するものではありません。
JSON例は次で構文検証できます。needs_reviewのままで実行承認にはなりません。

```powershell
npm run check:effect-v3 -- server/test/fixtures/v3-source-cost-draw.json
```

「DON返却・複合コストでドロー」は、発動元レスト・DONレスト1枚・手札1枚破棄・別のアクティブDON1枚返却を一括で支払う合成ケースです。
手札選択を確定→処理を進める→戻すDONを選択・確定→処理を進める→支払いを確定、の順です。
選択だけでは盤面は変化せず、支払い確定でリーダーレスト、ACTIVE DON 2→0、REST DON 0→1、DONデッキ8→9、手札5→4となります。
その後に処理を進め、ドローを実行して完了します。通常のルール上の発動・コスト順の裁定ではありません。
restDon/attachedDonからの返却はサーバーの合成fixtureテストで確認し、この画面のケースはactiveDon返却だけを使用します。
構文確認用の未承認JSON例も用意しています。

```powershell
npm run check:effect-v3 -- server/test/fixtures/v3-return-cost-draw.json
```

「複数エリアからDON返却」は、操作者側だけアクティブDON2枚・レストDON1枚・キャラ1の付与DON1枚・DONデッキ6枚で開始します。
DONレスト1枚・手札1枚破棄・3エリアからDON2枚返却を一括で支払う合成ケースです。
手札選択を確定→処理を進める→戻すDON2枚を選択・確定→処理を進める→支払いを確定、の順です。
アクティブDONは支払い用に1枚残す必要があるため、返却は最大1枚です。レスト/付与DONとの組合せ、またはレスト+付与DONを選べます。
支払い前は手札もDONも移動せず、確定後は選んだ2枚がDONデッキへ戻り、別のアクティブDON1枚がレストになります。
その後は処理を進めてドローします。初期盤面のDON付与はMovementEngineで検証用に行うもので、実カードの効果ではありません。

```powershell
npm run check:effect-v3 -- server/test/fixtures/v3-mixed-return-cost-draw.json
```

「任意発動・コストでドロー」は、「処理を進める」→「発動する/発動しない」の確認から始まります。
辞退すると双方に「発動せず終了」と表示し、盤面はそのままです。承認後は処理を進め、手札1枚選択→支払いを確定→ドロー、という既存の流れを使います。
承認直後ではDON・手札は変更しません。相手からの回答や期限切れ・古い確認tokenでの回答は拒否します。
needs_reviewの構文確認例を用意しており、実カードの任意発動タイミングや誘発処理を承認するものではありません。

```powershell
npm run check:effect-v3 -- server/test/fixtures/v3-optional-cost-draw.json
```

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

### 開発予定表（2026-10-29更新）

日付固定ではなく依存関係順の予定です。各段階を小さな変更へ分け、ビルドと関連テストを通してからpushします。
ユーザーが実機操作を確認し、見つかった不具合を次の拡張より優先します。通常対戦・一人回しへ自動的には反映しません。

| 順序 | 実装内容 | 完了条件 |
| --- | --- | --- |
| 現在 | 型付きJSON、承認ゲート、保存可能な選択/制御、複合コスト、任意発動確認 | 合成効果を両端末で選択・支払い・辞退できる。実カードの意味的承認はまだ0件 |
| 1（次） | 単発fixtureから連続操作できるv3試合進行基盤へ。ターン/プレイヤー/発動回数の管理 | 同じ盤面で複数効果を処理し、1ターン1回等をサーバーで検証。辞退や再送で回数を誤消費しない |
| 2 | 通常の手札からの使用・登場、対象条件、サーチ/一時公開/並べ替え | 空き枠・支払い・隠し情報・移動先を検証し、選択待ちから正しく再開。相手へ不要な情報を送らない |
| 3 | パワー/コスト修正、能力付与、期間管理 | 元の値を壊さず増減を合算し、指定したターン/イベント境界で失効。Registryの実行ハンドラー契約も拡張 |
| 4 | 登場時/アタック時/KO時等の誘発キューと裁定ポリシー | 発生原因を保持し、同時誘発を順序選択可能。未確認の順序は止まり、無限ループを防ぐ |
| 5 | バトル全体のv3接続 | アタック→効果→ブロック→カウンター→ダメージ/トリガー→終了をサーバー主導で進める |
| 6 | 少数のレビュー済み実カードをJSON登録し、制限付きテスト対戦へ | 必要な能力/条件/裁定が確認済みのカードだけを許可。両端末で開始から勝敗まで対戦できる |
| 7 | 置換・耐性・継続効果と対応カードの拡充 | 対象不可/効果を受けない/KO不可等を区別し、未対応を無視して進めない。必要なカードは段階6へ先行実装 |
| 8 | DB永続化・再接続復旧・負荷確認・公開環境への段階導入 | 盤面/制御/支払い記録を同時保存し、再起動後も二重処理せず復旧。既存モードと分離して導入 |

当面のv3画面は合成効果の検証用であり、従来のテスト対戦とは別です。「実カードで対戦できる」報告は段階6の完了条件を満たした時点で行います。
全カードの自動対応を段階6の前提にはしません。ただし未対応カードを効果なし扱いで参加させず、承認済みの狭い範囲から始めます。
カードテキストの曖昧な自動変換はせず、公式裁定の根拠と確認状態を保持します。必要な例外はRegistryとRulesetPolicyで追加します。

### 段階1の進捗：連続解決のサーバー内基盤

matchCoordinator.tsにV3SyntheticMatchCoordinatorを追加しました。mode:syntheticNoAbilities専用の基盤で、単発fixtureとは別のSocket/画面へ接続しています。
同一のMovementState/Progressionから複数のV3FixtureCoordinatorを順番に生成し、試合ID・盤面・既存トランザクション記録を維持します。
解決IDは毎回新しく作り、session/frame/movement/progressionのコンテキストと要求レシートを検証します。解決中・選択待ち・blockedでは別効果やターン終了を拒否します。
発動回数は、合成fixture用の信頼済みサーバー設定でカードID/効果IDごとにmaxPerObjectTurnを明示します。未指定を無制限扱いにはしません。
カウント単位はターン番号・操作者・発動元instanceId/generation・効果IDです。実カードの名称単位制限や一度離れて戻ったカードへの制限を裁定する実装ではありません。
コストなしの場合は発動条件成立後のCOSTS到達で、コストありの場合はPAY_COSTS適用成功でactivationCommittedを確定し、1回だけカウントします。
任意確認の承認だけ、辞退、発動条件不成立、支払い失敗では消費しません。支払い後に解決条件が不成立でも、すでに確定した分を戻しません。
このポリシーはDSLのusageLimitとは別の合成テスト設定です。JSON上のusageLimitは引き続き未対応で、実カード承認の代わりにはなりません。
endTurnは既存phaseWork契約を使用し、次のmainまでのrefresh/draw/DON checkpointをローカル候補状態で準備してからまとめて確定します。
リフレッシュでは次の操作者のレストカード/DONをアクティブ化し、付与DONをactiveDonへ戻します。通常ドローとDON追加はphaseWorkの枚数に従います。
デッキが空になるドローは裁定未対応として停止し、すでに準備したリフレッシュや進行も確定しません。誘発・置換・継続能力がない合成盤面だけが対象です。
DB復元・終了時能力・勝敗処理・実カード裁定はこの段階に含めません。

#### 連続操作のローカル検証

従来どおりnpm run dev:effects-v3で起動し、2つのブラウザーで画像ZIP・デッキ選択・同じルームへの入室・READYを行います。
ホストは操作者欄で初期手番を選び、「連続操作の検証開始」を押します。「単発効果の検証開始」は従来の各ケースのままです。
連続操作では、選択デッキのリーダー画像だけを使い、サーバー上のカードIDはV3-SESSION-LEADER-0/1へ置き換えます。
実カードの能力を実行・承認するものではありません。通常の手札からの登場・アタック・勝敗はまだ接続していません。
両側はアクティブDON2枚で開始し、初期マリガンや先後抽選も行いません。ここは本来の対戦開始手順ではなく合成テストの初期状態です。

- 「1枚ドロー」は各リーダー個体・各ターンに1回。ボタンの0/1、1/1で使用回数を表示します。
- 「任意発動・コストでドロー」は任意確認→手札1枚選択→DONレスト1枚と手札1枚を一括支払い→1枚ドローです。これも個体・各ターンに1回で、辞退では回数を消費しません。
- 効果完了後、同じ盤面で別の効果を開始できます。効果途中は新しい効果やターン終了を拒否します。
- 「ターン終了」は手番側だけが実行でき、次のプレイヤーのリフレッシュ・通常ドロー・DON追加を合成fixtureの範囲で準備します。試合IDと盤面は維持します。
- 次のターンでは新しいターン番号に従って使用回数を管理します。自分の次の手番で再び効果を使えます。
- ホストの「ルームへ戻る」でルームコードを維持して両者READY前へ戻します。ゲスト退出ではセッションを破棄し、ホストは部屋に残ります。

sessionProtocol.tsの専用コマンドはmatchIdとsession/frame/movement/progressionの全コンテキストを送ります。
操作者はSocketの所属から決め、リーダー発動元もサーバー側で選びます。クライアントによるactor/sourceの上書きや未知フィールドは拒否します。
新しい解決IDへの切替えはsession revisionの増加が必要で、前の効果・前の試合の遅い応答で画面を巻き戻しません。
候補tokenと手札情報は既存の可視性制御を使います。通信断後の試合復旧はまだ行わず、ルーム作成/入室からやり直します。
現時点の段階1は「合成ポリシーでの連続操作とターン進行」までです。次にDSL上の使用制限とその承認・失効単位を接続します。

```powershell
npm --prefix server run build
node --test server/test/v3-match-coordinator.cjs server/test/v3-resolution.cjs
node --test server/test/v3-session-server.cjs
node --test tools/test-v3-session-client.test.js
```

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
