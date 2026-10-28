# 汎用効果エンジン v3 導入記録

## 基準と今回の範囲

2026-10-28に渡されたeffect_engine_v3_codex_spec.mdを今後の基準とします。
添付のJSON例は3.0-draftの設計例であり、実行可能な効果や裁定済みfixtureではありません。
代表18件もNEEDS_MANUAL_RULE_REVIEWであり、正解の状態遷移として自動採用しません。
Phase 1の既存調査・CSV監査・監査用型/Schemaは完了しています。
Phase 2は、以下に記載した限定DSLのCompiler、Registry、承認ゲートまで実装しています。
v3全命令、レビュー操作画面、Runtime、実カード効果の実行は未実装です。

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

入力版は3.0.0-subset.2、Compiler版はv3-subset-compiler.2です。
旧subset.1、添付3.0-draft、既存dslVersion:1を暗黙変換しません。旧版の定義は明示更新と再レビューが必要です。
schemas/effect-v3-subset.schema.jsonは標準組み込み命令の編集用Schemaです。
Compilerは型・未知フィールド・参照先・比較の値型・ID重複・原文範囲・複雑度も検証します。
sourceSpanのstart/endはsource.textのUTF-16コード単位で、endは範囲外終端です。

対応するコンパイル命令：

- timing: MAIN。kindはactivatedのみ。leader/character/stageの自身のゾーンのみ。
- predicate: all / any / not / compare（eq / ne / lt / lte / gt / gte）。
- value ref: SELF/OPPONENTのlifeCount/handCount、SOURCE/CANDIDATEのcost/power/cardType/rotated、選択済みbindingsのcount。自由なJS式や任意プロパティ参照は不可。
- cost: REST_DON（1〜50）。
- action: DRAW / SEQUENCE / IF / SELECT / MOVE_CARD。
- selector: CARDS（表向き公開カードのみ、SELECT、UNORDERED）。

未対応：自動誘発、イベント、KO、非公開領域の選択、BLIND_SELECT/RANDOM/ALL/ORDER、usageLimit、optional、DON_RETURN、付与、期間、置換、継続、CUSTOM_HANDLER等。
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
受理後もapproved_not_executableです。requireExecutionはRuntime未実装として必ず停止します。

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
これはCompilerでの契約の明示であり、実候補の算出・選択待ち・応答処理はまだ実装していません。

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

### 続く段階

Phase 2の残りでは、非公開選択や順序選択等のCompiler対応を、実行可能な範囲と分けて拡充します。既存のkind形式は別版のまま維持します。
Phase 3で保存可能なResolutionFrameと選択待ち/復帰を接続します。Phase 4以降に置換・継続・バトル統合を進めます。
同時誘発の順序、複数置換の選択、勝敗チェックの位置、トリガー機会、KO誘発時点、継続効果の循環等は
RulesetPolicyとして根拠と確認状態を保持し、未確認の組合せでは停止する設計とします。今回は裁定を確定していません。

```powershell
npm --prefix server run build
node --test server/test/v3-compiler.cjs server/test/v3-selection-compiler.cjs server/test/effects-schema.cjs
node --test tools/audit-effect-cards.test.js tools/test-card-master.test.js
npm run build
```
