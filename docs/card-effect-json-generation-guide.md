# ChatGPT向け カード効果JSON生成ガイド

更新日: 2026-10-30。初回調査`e6ba075`、PR04実装開始`d6df2d4`。
PR04はDSLを変えず、leader/character/stage MAINの個体別発動元tokenと画面を接続しました。[PR04](card-effect-pr04.md)参照。イベントMAINは未対応です。
PR03のEXISTS/COUNT/QUERY_CARDSと数値の明示printed/current参照はsubset.18です。[PR03](card-effect-pr03.md)を併読してください。
PR02a/bの新Predicateはsubset.17です。詳細・全パラメータは[PR02](card-effect-pr02.md)を併読してください。
旧subset.16と承認14枚は併存し、旧hashを維持します。
対象: **隔離v3の現在の実装**。通常オンライン対戦、一人回し、旧テスト効果形式の仕様ではありません。
この資料作成ではゲームエンジンを変更していません。

## 最初に読む制約

約2,885種類すべてを、現状の命令で正しく実行可能にすることはできません。
未対応部分が1つでもあれば、その部分を消したJSONを完成品として提出しないでください。
本文は意味解析されないため、Compilerが通っても原文と同じ効果とは限りません。

生成結果は**候補**です。`reviewStatus:"needs_review"`とし、独立した承認manifestや承認ハッシュは生成しないでください。
`approved`と書き換えるだけでは実行できません。既存manifestを機械的に再承認する運用も禁止します。
不明な裁定、再録差異、未知の句、特徴条件などを推測で補完しないでください。

### ChatGPTに渡す資料

1. このガイド。
2. `card-effect-json-schema.json`（旧16）、`card-effect-metadata.schema.json`（17）、`card-effect-query.schema.json`（18）: Draft 2020-12。使用するカードのschemaVersionに合わせます。
3. `card-effect-types.ts.txt`: 現在の`dsl.ts`の型定義全文の写し。
4. `card-effect-supported-operations.json`: 18の44命令/17の41命令/旧16の38命令のパラメータ、例、profile、実行制約。
5. `card-effect-json-examples.json`: 新旧全文CardDefinitionの合成例14件。`card-effect-query-examples.json`: PR03の条件部分の合成全文例3件。
6. `card-effect-implementation-status.md`: 実装の層と未対応一覧。
7. `card-effect-pr02.md`と`card-effect-pr03.md`: メタデータ/能力タグ/集合の意味と互換性。
8. 入力CSV、差異一覧、タグ/パターン分析、元の代表例。後者は実行仕様ではなく参考資料。

`validate-card-effect-json.cjs`はCodex/開発者側の検証用です。ChatGPTには任意で渡せます。
情報の優先順位は実装コード、Compiler、当資料、旧仕様書の順です。

## 1. 正式な構造

実体は`server/src/test/effects/v3/dsl.ts`の`CardDefinition`と`Effect`です。
`EffectDefinition`という名前のv3型はなく、型名は`Effect`です。型全文は同梱の`.ts.txt`を参照してください。
Zod Schemaはありません。正規の実装バリデータは`compileV3CardJson`です。

### CardDefinition

| キー | 型・制約 |
| --- | --- |
| schemaVersion | 必須。集合条件は`3.0.0-subset.18`、メタデータは17/18。旧16も独立profileとして受理 |
| cardId | 必須、カード番号。ASCII識別子、100文字以下 |
| cardVersion | 必須、定義の版。例`draft.1`。同じ番号の変更時は更新する運用を推奨 |
| name | 必須、空白だけ不可、300文字以下 |
| cardType | 必須、`leader / character / stage / event`。DON定義はこの型では不可 |
| baseStats | 必須、`cost / power / counter / life`すべて必須。非負の安全な整数、またはnull |
| colors / traits / attributes | すべて必須、文字列配列、各32要素以下、重複不可。漢字/ひらがな/記号も保存可能 |
| keywords | 必須、対応するキーワードノード配列、最大4種類、重複不可 |
| reviewStatus | 必須、`needs_review / unsupported / approved`。生成候補はneeds_review |
| source | 必須、下表 |
| effects | 必須、Effect配列、0〜32件 |

| source内 | 内容 |
| --- | --- |
| text | 必須、本文をそのまま保持、最大32768 UTF-16コード単位 |
| triggerText | 必須、トリガー原文。なければ空文字。本文へ混ぜない |
| displayIds | 必須、1〜32件、重複不可。各IDもASCII識別子 |
| datasetSha256 | 必須、小文字16進64文字。実際の原資料ハッシュ。ChatGPTが捏造しない |

`cardId/cardVersion/effect.id/node.id`は`^[A-Za-z0-9][A-Za-z0-9_.:-]*$`、100文字以下で、`constructor/prototype`は禁止。
`bindAs`はより狭く`^[A-Za-z][A-Za-z0-9_]{0,63}$`です。日本語のカード名・特徴はよいですが識別子には使いません。
新17ではCARD_METADATAで特徴等を絞れます。旧16では保存のみで、新Predicateは受理しません。
数値不明・`-`・空欄を0としないでください。nullで保持し、必要な数値が不明な処理は承認しません。
印刷keywordsはcharacterなら4種、leaderならBLOCKER/CANNOT_BE_BLOCKEDだけです。stage/eventは空配列が必要です。

### Effect

全キー必須です。未使用のものも省略せず、`[]`、`null`、空allを明記します。

| キー | 型・意味 |
| --- | --- |
| id | 識別子。そのカード内の全Effect/node.idと重複不可 |
| kind | `activated / triggered` |
| timing | `{type:...}`、下表 |
| sourceZones | ちょうど1要素。場の効果はカード種類と同じ、event COUNTERはhand、TRIGGERはlife |
| optional | boolean。発動前の任意確認。actions内の任意支払いではない |
| usageLimit | null、または`{type:"PER_TURN",scope:"SOURCE_OBJECT",count:1}`等 |
| activationConditions | Predicate、発動の前提条件 |
| resolutionConditions | Predicate、支払い後に検査する条件 |
| costs | 発動コスト配列 |
| actions | 1件以上のアクション配列、記載順に実行 |

| timing | 許可される組合せ |
| --- | --- |
| MAIN | activated、leader/character/stage、sourceZonesは同じ種類 |
| ON_PLAY | triggered、character/stage、自身の登場 |
| ON_ATTACK | triggered、leader/character、自身の攻撃 |
| ON_OPPONENT_ATTACK | triggered、leader/character/stage、相手攻撃時に場の定義を監視 |
| ON_KO | triggered、character、sourceZones:[character]、costs空 |
| COUNTER | activated、event、sourceZones:[hand]のみ |
| TRIGGER | triggered、leader以外、sourceZones:[life] |

triggeredのactivationConditionsは`{type:"all",conditions:[]}`のみ。
条件付き誘発成立を扱う機能はありません。必要な成立条件を解決時IFに勝手に変更しないでください。
COUNTERイベント/TRIGGERはoptional:false、usageLimit:null、costs:[]、activation空allが必須です。
ON_KOはSOURCEのcost/power等の参照が不可です。BIND_SOURCEは移動後のトラッシュ個体を束縛します。
TRIGGERはSOURCE値/BIND_SOURCEも不可で、triggerText非空とTRIGGER定義ちょうど1件が対応します。

### ネスト・複数効果・ID

`effects:[効果A,効果B]`で複数効果を定義し、1つの効果の複数手順は`actions:[...]`へ並べます。
IFのthen/elseにはアクション配列、SEQUENCEにはactions配列、all/anyにはconditions配列を置きます。
IF内で作成した束縛はIFの外へ出ません。SEQUENCEは新しいスコープを作りません。

効果IDの意味的な命名規則は実装にありません。既存データにはmain等の短いIDがあります。
大量生成では`on_play.1 / main.1 / on_attack.1 / counter.1 / trigger.1`等を推奨します。
これは運用上の提案であり、命令名や必須プレフィックスではありません。
同一カード内でnode.idとEffect.idの衝突も避けます。node.idは省略可能なので不要なら付けません。

ノードの省略可能フィールドは`id/sourceSpan`だけです。Effect/Cardに余分なメモ欄は追加できません。
sourceSpanは`{start,end}`で、0始まり・end排他、JavaScript文字列のUTF-16オフセットです。
TRIGGER内はtriggerText、それ以外はtextの範囲。誤ったオフセットを付けるくらいなら省略します。

1カードのJSONは256KiB以下、走査対象は4096値以下、深さ24以下、一般の配列は128要素以下です。
これに加えeffects最大32、文字列配列最大32、countは1〜50などの個別制限があります。
数値はJavaScriptの安全な整数範囲です。文字列にした数字やNaN/Infinityは使えません。

## 2. Registryと命令一覧

`builtinV3Registries()`が`V3Registry`をカテゴリー別に返します。個別のTriggerRegistry等のクラスではありません。
各命令の**JSON全パラメータ、必須/任意、例、制約**は`card-effect-supported-operations.json`に収録しています。
`parameterSchemas`の$refは同梱Schemaの$defsを指します。default値はなく、省略による補完はありません。

| 依頼のRegistry | 現在の対応物 | 使用できるtype |
| --- | --- | --- |
| TriggerRegistry | timing Registry + triggerScheduler.ts | MAIN, ON_PLAY, ON_ATTACK, ON_OPPONENT_ATTACK, ON_KO, COUNTER, TRIGGER |
| PredicateRegistry | predicate | all, any, not, compare。17/18にCARD_NAME, CARD_METADATA, HAS_ABILITY。18にEXISTS, COUNT |
| QueryRegistry | query | 18のみQUERY_CARDS。条件専用でSELECTのselectorではない |
| CostRegistry | cost | REST_DON, REST_SOURCE, DISCARD_HAND, DON_RETURN |
| SelectorRegistry | selector | CARDS, BOUND_CARDS |
| ActionRegistry | action | BIND_SOURCE, GRANT_KEYWORD, MODIFY_STAT, LOOK_TOP, REVEAL, ORDER_CARDS, RETURN_TO_DECK, DRAW, SEQUENCE, IF, SELECT, MOVE_CARD, KO, REST, SET_ACTIVE |
| ReplacementRegistry | replacement | **0件、未対応** |
| ModifierRegistry | 専用Registryなし | MODIFY_STAT/GRANT_KEYWORD + statEffects.ts/keywordEffects.tsの期間付き台帳のみ |
| DurationRegistry | duration | TURN_END, BATTLE_END |
| その他 | keyword | BLOCKER, RUSH, RUSH_CHARACTER, CANNOT_BE_BLOCKED |

注意: `server/src/test/effects/registry.ts`は旧schemaOnly Registryです。そこにある語彙をv3実装済みとして使いません。
下位MovementStoreにattach/置換に関連した型があっても、v3 JSONから使える命令とは限りません。

### 主要な実行時制限

- MOVE_CARD: destinationはhand/trash/publicならappend・faceUp:true、deckならtop/bottom・faceUp:false。カード所有者への移動のみ。leader/DON不可。
- MOVE_CARDの移動元: 公開character/stage/trash/public、自分手札、自分の閲覧済みデッキ。デッキ内の並べ替えにはRETURN_TO_DECKを使います。
- KO: 公開character限定。REST/SET_ACTIVE: 公開leader/character/stage限定。DONのREST/SET_ACTIVEアクションではありません。
- MODIFY_STAT: 既知の値を持つ公開の場のカード。power/costのみ、増減は0以外の整数±100000。コストの現在値は0未満を0へ丸めます。
- GRANT_KEYWORD: 場のleader/characterのみ。leaderにはBLOCKER/CANNOT_BE_BLOCKEDだけで、RUSH/RUSH_CHARACTERはcharacterのみです。stageには付与できません。
- BATTLE_END: バトル外で実行不可。TURN_ENDは指定側のターン終了をoccurrence:1/2回数えます。自分ターン中だけの継続効果ではありません。
- SELECTのmin不足は自動で可能枚数に緩和しません。onInsufficientはfailのみ。LOOK_TOPだけはtakeAvailableも使えます。
- MOVE_CARD/REVEAL/RETURN_TO_DECK/修正等の空集合workは不可。最大N枚選択で0枚を許す場合、束縛枚数>0のIFで後続を囲みます。
- 移動によってgenerationが変わります。移動前の束縛を後続でそのまま再使用すると古い参照として拒否され得ます。IDから追跡し直す命令はありません。

## 3. 条件式

`SELF`はその効果の操作者、`OPPONENT`は反対側です。画面の上下やホスト/ゲストではありません。
Valueのrefは以下だけです。

```text
SELF.lifeCount / SELF.handCount / OPPONENT.lifeCount / OPPONENT.handCount
SOURCE.cost / SOURCE.power / SOURCE.cardType / SOURCE.rotated
CANDIDATE.cost / CANDIDATE.power / CANDIDATE.cardType / CANDIDATE.rotated
bindings.<既存の束縛名>.count
```

CANDIDATEはselector.filtersまたは新18のquery.filters内だけ。SOURCEは場など現在の参照であり、任意の最終情報ではありません。
不明値は0/null/falseへ置き換えずunknownとして安全停止します。

| 要望 | 記述/可否 |
| --- | --- |
| 自分ライフ2枚以下 | 下例A |
| 相手の場にcost5以上のキャラが存在 | 新18のEXISTS + QUERY_CARDS（owner/controller:OPPONENT,zone:character）+ compare CANDIDATE.current.cost >= 5。条件付き誘発成立の解禁とは別 |
| 自分リーダーに特定特徴 | SOURCEがそのリーダーなら17/18のCARD_METADATA。18ではQUERY_CARDSのzone:leaderと同じfilterで存在判定も可能 |
| 自分ターン中 | 汎用条件として未対応。MAINの発動タイミング制限だけは存在 |
| このキャラが登場したターン | Predicate未対応。バトルの登場ターン制限実装とは別 |
| 自分手札5枚以上 | 下例B |
| AND/OR/NOT | all/any/not、下例C |
| 原因が相手カード効果 | Predicate未対応。サーバー内の移動原因記録をJSONから参照できない |
| 対象がSOURCE以外 | selector.excludeSource:true、または新18のquery.excludeSource:true。ref比較の架空命令は作らない |

```json
{"type":"compare","left":{"ref":"SELF.lifeCount"},"op":"lte","right":2}
```

```json
{"type":"compare","left":{"ref":"SELF.handCount"},"op":"gte","right":5}
```

```json
{
  "type":"all",
  "conditions":[
    {"type":"compare","left":{"ref":"SELF.lifeCount"},"op":"lte","right":2},
    {"type":"any","conditions":[
      {"type":"compare","left":{"ref":"SELF.handCount"},"op":"gte","right":5},
      {"type":"not","condition":{"type":"compare","left":{"ref":"SOURCE.rotated"},"op":"eq","right":true}}
    ]}
  ]
}
```

compare.opはeq/ne/lt/lte/gt/gte。順序比較は数値同士のみ。eq/neも型不一致を原則拒否します。
空allはtrue、空anyはfalseです。`{}`や文字列の式ではありません。

## 4. コストと対象選択

### 発動コスト

```json
{"type":"DON_RETURN","count":1,"from":["activeDon","restDon","attachedDon"]}
```

DON-2ならcount:2。アクティブ限定ならfrom:["activeDon"]、付与中限定ならfrom:["attachedDon"]です。
付与元リーダーだけ/特定キャラだけに限定するパラメータはありません。
DON_RETURNは1効果1件、指定した複数領域の中から本人が枚数分選びます。
REST_DONと併用する場合、同じアクティブDONを返却とレストの両方に使えません。

```json
[
  {"type":"REST_DON","count":1},
  {"type":"DISCARD_HAND","count":1},
  {"type":"REST_SOURCE"}
]
```

これはEffect.costsへ置く配列です。actionsに同じノードを入れません。
REST_SOURCEは最大1件。DISCARD_HANDは特徴による制限を持ちません。
支払い候補を検査したうえで一括確定し、再送で二重払いしません。

### 対象を選び、同じ対象を次の処理へ渡す

```json
[
  {
    "type":"SELECT","bindAs":"targets",
    "selector":{
      "type":"CARDS","owner":"OPPONENT","controller":"OPPONENT",
      "zone":"character","cardTypes":["character"],
      "filters":{"type":"all","conditions":[]},"excludeSource":false,
      "faceUpOnly":true,"min":0,"max":2,"visibility":"PUBLIC",
      "selectionMode":"SELECT","chooser":"SELF","order":"UNORDERED","onInsufficient":"fail"
    }
  },
  {
    "type":"IF","condition":{"type":"compare","left":{"ref":"bindings.targets.count"},"op":"gt","right":0},
    "then":[{"type":"REST","cards":{"ref":"bindings.targets"}}],"else":[]
  }
]
```

同じtargetsを後続のMODIFY_STAT等でも参照できます。ただし領域移動で古くなった参照は使えません。
自分キャラを手札へ戻す場合はowner/controllerをSELFにし、MOVE_CARD.destinationを
`{owner:"SELF",zone:"hand",position:"append",faceUp:true}`へします。全文例10は相手側版です。

| 要望 | 対応 |
| --- | --- |
| リーダーへDONを付与 | 通常操作attachDonはあるが効果DSLは未対応 |
| 自分の手札から2枚公開 | CARDSの自分hand、min/max:2→REVEALは可能 |
| 指定特徴の手札2枚公開 | 新17のCARDS.filtersにCARD_METADATA→REVEALは可能。発動cost化は未対応 |
| 手札公開を発動コストとする | コスト命令なし。actionsのREVEALで代用不可 |
| 相手手札を見ずに選ぶ | 非公開相手handの選択は未対応 |
| 効果途中の任意支払い | actions内の支払い命令なし。optional:trueは効果全体の発動前確認 |

自分handのselectorはowner/controller/chooser:SELF、visibility:OWNER_ONLY、faceUpOnly:falseです。
自分DONはowner/controller/chooser:SELF、visibility:PUBLIC、faceUpOnly:true、cardTypes:["don"]、zoneをactive/rest/attached単体または配列にします。
CARDSでdeck全体やlifeは選択できません。デッキ上の選択はLOOK_TOP→BOUND_CARDSです。

## 5. 15種類の全文JSON例

全文は`card-effect-json-examples.json`の各`examples[].card`にあります。
ファイル全体は索引であってCardDefinitionではありません。カード単位に取り出して検証します。
未対応はstatus:unsupported、card:nullです。架空命令のJSONは含めていません。

| 番号 | 内容 | 現在の表現 |
| --- | --- | --- |
| 1 | 登場時2枚ドロー | ON_PLAY→DRAW2 |
| 2 | MAIN/ターン1回/DON-1/相手power-2000 | DON_RETURN、SELECT、IF、MODIFY_STAT。例では最大1枚・SELFターン終了までと明記 |
| 3 | アタック時に条件付きドロー | 解決時の手札枚数IF。誘発成立条件ではない |
| 4 | 自分ターン中power+1000 | **継続効果は未対応** |
| 5 | 登場時に速攻付与 | BIND_SOURCE→GRANT_KEYWORD。例の期限は自分ターン終了 |
| 6 | イベントMAIN | **未対応** |
| 7 | イベントCOUNTER | 印刷costの支払い→使用→自分リーダーへBATTLE_END修正 |
| 8 | ステージON_PLAY | stage→DRAW1 |
| 9 | ステージMAIN | REST_SOURCE→DRAW1。核は対応、現状Socketはリーダー固定のためUIからの発動は未接続 |
| 10 | 相手キャラを手札へ | SELECT→MOVE_CARD、owner一致 |
| 11 | 相手手札を盲目的に捨てる | **未対応** |
| 12 | 場を離れる代わりに別キャラ破棄 | **置換未対応** |
| 13 | 相手効果でKOされない | **耐性未対応** |
| 14 | 条件付きブロッカー付与 | 解決時IF + 期限を明示した付与のみ。常時条件や誘発成立時条件は未対応 |
| 15 | 上5枚サーチ | 既存例はcost3以下。PR02追加例は名前除外+特徴条件。公式カード全体の承認ではない |

合成例は全てneeds_review、ハッシュ0埋めは検証用プレースホルダーです。公式カードの定義・原資料・承認ではありません。
期限や対象条件を省略した質問に対して、例で選んだ値を実カードへ勝手に適用しないでください。

## 6. 解決順序と実行時

`resolution.ts`の順序はactivationConditions→optional確認→costs→resolutionConditions→actions→公開権限等の後始末です。

- 発動条件不成立なら発動しません。解決条件は支払い後です。不成立でも支払い済みコストを返しません。
- optionalは効果全体の発動辞退です。任意の対象枚数はmin:0等で別途記述します。
- ターン制限は試合のturnNumber/actor/発生元instanceId+generation/effectId単位です。離れて戻った同名カードや名称単位制限を同じ扱いにしません。
- 回数消費はactivationCommittedで1回のみ。任意辞退/発動不成立/支払い失敗は消費しません。支払い後の不発は消費を戻しません。
- 同一actions配列は順番どおり。複数誘発は発生群を保持し、同群のターンプレイヤー側→非ターン側、各本人が自分の候補順を選びます。effects配列順で全て自動解決するわけではありません。
- 選択時は停止し、本人だけへ不透明tokenを渡します。回答の操作者/selectionId/revision/期限/重複を検証して再開します。
- 実処理はworkとしてCoordinatorへ渡し、盤面・制御・台帳を候補状態で検証して確定。古い要求や内容を変えた再送は拒否します。
- KOはEFFECT_KO/BATTLE_KO、isKOと移動前後の証拠で判別。単なるMOVE_CARD→trashはKO時を発動しません。
- v3の汎用置換処理は未接続です。FixtureCoordinatorはMovementStoreへcertifiedNoneを渡します。置換を要するカードを承認してはいけません。
- 永続効果の再計算は未対応。期間付き数値/キーワード台帳の合算・期限解除は実装済みですが別物です。
- イベントCOUNTERは使用時に印刷costをレストし、カードをhand→trashへ移してからその移動証拠で効果を解決します。追加のcostsは空。使用後に手札へ戻すような自己処理は自動で行いません。
- TRIGGERは一時的な内部resolving保管（ゲーム上の領域ではない）で解決し、通常は最後にtrash。自己登場等は未対応。勝敗確定なら後続処理を追加しません。
- 通常のキャラ/ステージ登場は自分MAIN、既知の印刷cost全額を支払い、空き枠へ移動→ON_PLAYを待機。cost不足なら出せません。手動操作版の別仕様をv3へ持ち込みません。
- 現状ステージ枠が埋まっている場合の通常登場は拒否します。既存ステージとの自動交換処理はありません。
- 通常のDON付与は試合コマンドです。効果DSLからのDON付与とは別です。

### コンパイルできるが、UIから使えるとは限らない

核のeffectsFor/activateは場の発生元を扱えますが、`localServer.ts`のv3-session:command/activateは現在session.sources[actor]（リーダー）を渡します。
キャラ/ステージMAINのJSONが受理されることを、画面から発動可能という意味で宣伝しないでください。
また、範囲上限・古い世代・数値不明・バトル外BATTLE_END等、盤面が必要な検査はCompilerだけでは完結しません。

## 7. CSVからJSONへの変換

### 2つの取込処理を混同しない

1. `tools/build-card-master.js`: 手作業の簡易CSVからpublic/card-master.jsonを作る既存機能。効果DSLコンパイラではありません。
2. `tools/audit-effect-cards.js`: 公式20列CSVの監査と差異抽出。ReviewBundleを作りますがeffectsは空、実行不可です。

簡易CSVのeffects:onPlay|onAttack|onKoやeffectIdsはv3 actionsではありません。
card-effects.csvのimplementationはmanual/unsupportedだけを許可し、実行命令を登録する仕組みではありません。
公式CSVをそのままbuild:card-masterへ渡しても列形式が違うため動きません。

### 公式CSVの列

cardData.tsのSOURCE_COLUMNSは以下の20列です。監査は全列の存在/重複/列数を検査します。

```text
表示ID,カード番号,カード名,レアリティ,種類,コスト,ライフ,属性,パワー,カウンター,色,ブロックアイコン,特徴,テキスト,トリガー,入手情報,収録弾ID,画像URL,出典URL,取得日
```

| CSV列 | v3候補への対応 |
| --- | --- |
| カード番号 | cardId。表示IDから推定しない |
| カード名 | name |
| 種類 | LEADER/CHARACTER/STAGE/EVENTを対応する小文字へ。DONはこのDSL対象外 |
| コスト/パワー/カウンター/ライフ | baseStatsの対応値。空欄/NULL/-はnull、未知を0にしない |
| 色/属性/特徴 | colors/attributes/traits。区切りは入力の実データを確認すること。汎用の自動分割規則は実装されていない |
| テキスト | source.text。本文のキーワードをkeywords、各能力をeffectsへ漏れなく対応させる |
| トリガー | source.triggerText。対応可能ならTRIGGER定義1件。未対応ならカード全体を隔離 |
| 表示ID | source.displayIds。cardIdと混同しない |
| 出典URL/取得日等 | 別の原資料/監査記録へ保持。CardDefinitionに余計なキーとして追加不可 |

CardDefinition.source.datasetSha256には実資料のハッシュを使います。ただしハッシュの意味は経路で異なります。
監査のsourceSha256はCSVファイルの**生バイト**SHA256です。
実カードLoaderが照合するdatasetSha256は、manifestにある**原資料スナップショットJSONのJSON.stringify(JSON.parse(...))**のSHA256です。
CSVのハッシュをそのまま既存reviewed LoaderのJSONスナップショットハッシュとして扱ってはいけません。
ChatGPTには開発者側で計算した正しい値と原資料を渡します。未計算ならそのカードを保留にし、実用候補を0埋めで作りません。

### 別イラスト・再録

公式CSVはカード番号ごとにまとめ、表示IDごとのraw/recordNumberを監査に残します。
本文/数値/特徴等に差異があれば、正規化だけの差でも自動で同じ能力と承認しません。
現カタログはcardIdごとに1定義しか保持できず、同じcardIdの複数版を同時登録できません。
displayIdsは由来記録であり、任意の画像IDを正規カード番号へ変換するランタイムalias機能ではありません。
選んだ版と判断理由を別のレビュー記録に残します。CSV列や記号の不足を都合よく補わないでください。

### 出力先と読み込み

**生成候補の作業用提案**: `local-data/effect-json-candidates/<cardId>.json`、1カード1ファイル。
これは新しい自動取込機能ではなく、人が候補を置くための場所です。local-dataがGit除外されていることをgit check-ignoreで確認します。
未対応一覧は別の`unsupported-effects.json`等に、cardId/表示ID/未対応原文/理由/必要な命令/要裁定事項を記録します。
その一覧は実行DSLでもReviewBundleでもありません。候補フォルダの外へ置きます。

承認済みの実在配置先は`server/data/effects-v3-reviewed/cards/<file>.json`、原資料はsources/、承認表はmanifest.jsonです。
Loaderはmanifestに列挙したファイルだけを読んでCompiler→原資料一致→独立承認ハッシュを検証します。
ファイルをcards/へ追加しただけでは読みません。ファイル名はカードIDに連動必須ではなく、manifest経由です。
256KiB上限、ファイル名/シンボリックリンク検査あり。manifestのcards/sourcesは**各128件上限**で、大量配備には別途拡張設計が必要です。
今回はその制限を変更していません。

ルームの限定プリセット選択/開始時にロードし、未承認/不整合/未知の型等は例外で拒否します。
Socket側は操作失敗を返し、能力なしカードとして試合を続行しません。エラーが日本語汎用メッセージになる場合があるので、事前にCLI検証します。

## 8. 検証方法

コマンドはすべて`C:\Users\kensh\workspace_server`のPowerShellから実行します。
この資料用チェッカーは既存Compilerを呼びますが、承認・デプロイ・ゲーム状態変更はしません。

### 最小: 既存Compilerで1枚

```powershell
npm run check:effect-v3 -- local-data/effect-json-candidates/OP01-000.json
```

これはserver build後にJSON構文、必須/未知キー、命令、束縛順/スコープ、参照の許可範囲、timing組合せ等を検査します。
出力はcompiled_not_executable、executable:falseです。存在しないカード番号も識別子として正しければ通る点に注意してください。

### 複数候補をまとめてCompiler検証

```powershell
npm --prefix server run build
node docs/validate-card-effect-json.cjs local-data/effect-json-candidates
```

JSON以外は無視し、サブフォルダも確認します。候補以外の索引JSONは混ぜないでください。
同一cardIdの重複を検出し、各ファイルの失敗を一覧にします。1件でも失敗なら終了コード1です。
JSON Schemaを実行しない場合はschemaValidation:not_performedを明記します。

### JSON Schemaも併用（Ajv 8を一時ディレクトリに導入）

既存アプリのpackage.json/lockは変更しない手順です。初回のみネット接続が必要です。

```powershell
$validatorDir = Join-Path $env:TEMP 'tcg-card-effect-validator'
npm install --prefix $validatorDir --no-save --ignore-scripts --no-audit --no-fund ajv@8
$previousNodePath = $env:NODE_PATH
try {
  $env:NODE_PATH = Join-Path $validatorDir 'node_modules'
  node docs/validate-card-effect-json.cjs --schema local-data/effect-json-candidates
} finally {
  $env:NODE_PATH = $previousNodePath
}
```

Schemaは構造の補助検査です。既存Schemaの写しであり、条件間の全関係、bindingの存在、node ID重複、sourceSpanの上限などはCompilerで検査します。
Schemaだけで合格にせず、Compilerを常に併用します。文字長もSchemaのUnicode文字数とJSのUTF-16で差があり得ます。
ゲームエンジン側はAjv/Zodに依存せず独自Compilerを使っており、この手順は必須依存を追加しません。

### 同梱の例を検証

```powershell
node docs/validate-card-effect-json.cjs --examples docs/card-effect-json-examples.json
```

Schemaも行う場合は前節のNODE_PATH設定内で`--schema --examples`を指定します。
非対応5件はunsupportedとして報告し、全文カード14件（初期追加例2件、PR02追加例2件含む）を検証します。
未対応をコンパイル失敗の架空カードとして生成しません。

### 原資料に存在しないcardId

監査結果のcard-review.jsonがある場合、次を追加できます。

```powershell
node docs/validate-card-effect-json.cjs --source-review local-data/監査結果/card-review.json local-data/effect-json-candidates
```

これはReviewBundleを検証してcardIdの存在を調べるだけです。本文/数値/表示IDの完全一致や意味的裁定を承認する検査ではありません。
DSLには任意の固定cardIdを参照する命令はなく、cards.refは盤面の束縛です。未定義束縛はCompilerが検出します。
承認済みロード時はreviewedCatalog.tsが原資料の基本情報/本文/トリガーまで一致を確認します。

### 実際のゲーム処理のテスト

候補1枚ごとに期待する初期盤面・選択・結果・失敗条件を作り、既存Coordinatorへ承認済みの検証fixtureとして渡す作業が必要です。
本文から自動で正しい期待結果を決める万能テストはありません。以下は既存テストの例です。

```powershell
npm --prefix server run build
node --test server/test/v3-reviewed-entry.cjs
node --test server/test/v3-reviewed-catalog.cjs
```

選択0枚/候補不足/境界コスト/支払えない/所有者違い/移動後世代/期限/古いrevision/再送/相手への秘匿を確認します。
同じ効果を両操作者で確認し、非対応能力や成立条件を丸ごと落としていないこともレビューします。
現画面の限定プリセットで自動的に新カードを試せるわけではありません。

## 9. 大量生成を依頼するプロンプト例

```text
このガイドと現在のsubsetのみを使用してください。旧概念DSLの命令は使わないでください。
入力は公式CSVと監査データです。まず20〜30カード単位で処理してください。
cardId単位で本文・トリガー・キーワードを全て列挙し、全て表現できるカードだけCardDefinitionを生成してください。
生成候補はneeds_review、1カード1JSONとし、余計なメモキーを足さないでください。
datasetSha256は私が渡す原資料スナップショットの値だけを使ってください。未提供なら保留してください。
部分未対応、再録差異、裁定不明、必要な数値欠落は別の未対応一覧へ理由と原文を残してください。
本文の条件を解決時条件へ勝手に変えたり、期限・対象枚数・任意性を推測したりしないでください。
実行承認manifest・approvedへの変更・独立承認ハッシュは作らないでください。
生成数と保留数の合計が入力cardId数と一致するよう報告してください。
```

最初の少量をCodex側でCompiler/代表的な盤面テストに通してから、同じ変換パターンを増やします。
現状の対応範囲では、多数が正しく保留になることが期待されます。「全件JSON化率」を優先しないでください。

## 調査した主な実装

- `server/src/test/effects/v3/dsl.ts`: 型定義全文。
- `compiler.ts`: Registry、構造/参照/条件/組合せ検証、ハッシュ、上限。
- `resolution.ts`: 発動順序、選択/スコープ/再開、work生成。
- `fixtureEnvironment.ts`: Value評価、対象候補、支払いの前提。
- `fixtureCoordinator.ts`: 実行時の所有者/領域/世代チェック、移動・公開・修正work適用。
- `matchCoordinator.ts`: 試合進行、通常登場、回数、公開の現在値、メイン効果候補。
- `triggerScheduler.ts`、`counterEvents.ts`、`lifeTriggers.ts`、`effectExpiry.ts`: 誘発/使用/期限。
- `approval.ts`、`reviewedCatalog.ts`、`reviewedDeck.ts`、`localServer.ts`: 独立承認、読込、試合/Socket入口。
- `cardData.ts`、`tools/audit-effect-cards.js`、`tools/build-card-master.js`: 公式CSV監査と簡易マスターの区別。
- `schemas/effect-v3-subset.schema.json`: 構造Schemaの元。

## 初回生成資料の確認結果（旧16）

2026-10-29、基準コードに対して以下を確認しました。

- 全文合成例12件: CompilerとAjv 8/Draft 2020-12 Schemaの両方で失敗0件。
- 要望15件のうち5件: 未対応としてcard:nullで隔離。対応済みと見せる架空JSONはなし。
- 命令一覧38件: 実際のbuiltinV3Registriesのカテゴリー/名前/handlerVersionと全件一致。
- 未知命令、未定義束縛、範囲外CANDIDATE、event MAIN、特徴ref、条件付き誘発成立、不正な登場destinationの7件: Compilerがすべて拒否。
- 既存のサーチ/不足枚数のCoordinatorテスト2件: 成功。全文12例の全状況を実行テストしたという意味ではありません。
- サーバー/フロントのビルド: 成功。フロントは既存の500KiB超チャンク警告あり、エラーなし。

合成例は公式CSVのcardId存在検査・意味的裁定・独立承認の対象ではありません。
ゲームエンジンの変更や、生成した公式カードの独立承認は行っていません。

PR02更新では新17のPredicate3種類と合成例2件を追加しました。現在の新旧全文例14件は両Schema/Compilerで確認済みです。
初回の「特徴ref拒否」はSOURCE.traits等の未定義Value.refを指し、新しいCARD_METADATAノードを拒否するという意味ではありません。
新旧profileの承認と対応範囲、検証結果は`card-effect-pr02.md`を参照してください。
