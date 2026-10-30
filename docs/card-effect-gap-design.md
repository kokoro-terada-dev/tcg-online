# 隔離v3 効果機能拡張の設計案

基準: `0cd0883` / 2026-10-29。
**本書の新しい型・ノード名・処理はすべて提案であり未実装です。現在のsubset.16へ投入しないでください。**
今回、ゲームコード・Schema・承認manifestは変更していません。

後続の実装更新: PR00/01は`af3711a`、PR02a/bはCARD_NAME/CARD_METADATA/HAS_ABILITYとして実装しました。
本書の提案名とは区別し、現行の正確な構造は`card-effect-pr02.md`を参照してください。それ以外の提案を実装済みと扱わないでください。

## 1. 方針

カード番号専用の分岐を増やさず、型付きの汎用ノードを段階的に追加します。
現在のcompile→承認→解決機械→work→MovementStoreの流れは維持し、条件/権限/原因/継続/置換の責務を分けます。
一度に型をすべて受理する変更はせず、その段階でRuntimeとテストが接続されたノードだけをRegistryへ公開します。

「Compilerが通る」「単体workが動く」「そのカードの全能力が同義」「画面から使える」「承認済み」は別のゲートです。
新命令の宣言だけ、または片方の能力だけの実装でカード全体を承認しません。
任意JSONからコード/関数/URL/正規表現/ファイルを評価する仕組みは作りません。

## 2. 既存実装を残す境界

| 既存箇所 | 活用する点 | 拡張時の注意 |
| --- | --- | --- |
| dsl.ts / compiler.ts | 型付きRegistry、スコープ、上限、ハッシュ | 新しい参照/対象/ノードは明示パース。旧planを暗黙変換しない |
| resolution.ts | 中断/再開、署名フレーム、work/choice | 支払い途中や置換待ちのフレームも版付きで保存。命令長上限を保持 |
| fixtureEnvironment.ts | 主語・操作者の相対化、unknown、可視性 | 共通の実効値参照へ寄せ、選択だけ独自の値を読む経路をなくす |
| fixtureCoordinator.ts | 候補状態を検証して確定 | 置換が必要な場合のcertifiedNone禁止。全workが同じルール検査を通る |
| movement/engine.ts | 世代、移動前後、cause、公開権限 | 防止フックはあるがdeferは例外。選択待ち置換は上層で準備してから渡す |
| matchCoordinator.ts | 試合ゲート、回数、イベント群、バトル | 新しい待機状態は通常操作/ターン終了と排他。通常対戦・一人回しへ漏らさない |
| localServer.ts / src/testMatch/ | Socket主体の権限、版管理 | actorはsocket所属から決定。発生元だけopaque tokenで選択できるよう拡張 |
| approval.ts / reviewedCatalog.ts | 独立承認・出典照合 | 現状128件上限。後段で分割カタログ対応。生成者にmanifest更新権限を渡さない |

新規モジュール候補名（例: derivedFacts.ts、eventContext.ts、replacementPlanner.ts）は設計名です。
既存ファイルの存在を偽った参照ではなく、実装段階で初めて作成可否を決めます。

## 3. 共通基盤

### 3.1 イベント文脈と値の履歴

現状のEventCauseはkind/actor/effectController/source/resolutionId/parentEventIdを持ちます。
このactorを「効果を使った側」「カード所有者」「手札を選ぶ側」と取り違えない設計が必要です。
提案のEventContextは次を不変に固定し、クライアント入力で上書き不可とします。

- 根本の効果操作者、現在の選択者、影響を受ける側、元イベント/親イベント/発生群。
- 攻撃元/先、battleId、turn/phase境界、発生元の当時の参照。
- 必要な場面だけの移動前後の情報。LKIを任意カード追跡APIにしない。
- 読み出せるフィールドと可視性ラベル。公開情報から保持した値と、秘匿の手札値を区別。

EB01-020の「戻したキャラと異なる色」は、移動前に記憶する色を後続へ渡す必要があります。
現在のbindingsの古いgenerationを無視する変更は不可です。
提案のRememberedFactsは特定の移動workの結果に紐付く型付き値で、カード実体参照とは別のスロットへ保存します。
公式に参照可能な場面を確認してから許可し、未知の「最後の情報」を一律に解禁しません。

### 3.2 実効値参照の共通化

選択条件、攻撃力計算、cost判定、画面投影が同じDerivedCardFactsを使う設計にします。
base/originalとcurrentを区別し、cost/power/counter/traits/colors/attributes/keywords/abilityTagsを型付きで返します。
未知はUNKNOWNであり0ではありません。手札等の基本情報も閲覧権限を満たす環境だけが参照します。
効果による登場時に印刷costを払うか、現在値を使うか等はノードのゲーム手続と公式根拠で分離します。

### 3.3 対象集合と権限

選択のためのSelectorと、枚数/存在を検査するQueryを分けます。
どちらも同じ型付きfilter/領域列挙を利用しますが、QueryはカードID一覧を端末へ送る手続ではありません。
非公開領域の検索結果1bitも情報漏れになり得るため、誰が条件を確認できるかを扱います。
範囲外の隠し条件を「サーバーなら読める」と無条件に許可しません。

## 4. 不足機能と汎用ノード案

以下の名前は**提案専用**です。正確な命名/Schemaは各段階の実装前に固定します。
本文抜粋は入力CSVの要求確認用で、引用だけを裁定の根拠にしていません。

### F01 メタデータの条件とフィルター

- 代表: OP01-016「『ナミ』以外の特徴《麦わらの一味》」、OP14-087「『B・W』を含む特徴」、P-160「属性(知)」。
- 不足: 名前完全一致/除外、特徴要素の完全一致と要素内部分一致、色集合、属性、能力タグの区別。
- 提案: CARD_FIELD、HAS_ELEMENT、TEXT_CONTAINS_LITERAL、HAS_ABILITY_TAG。member/any/all等を型として分離。正規表現は不可。
- 改修候補: dsl/compiler、fixtureEnvironment、共通DerivedCardFacts、BOUND_CARDS filters。
- 安全性: 候補者に見せてよいカードだけで評価。D/ＤをNFKCで同一名にするルールは自動採用しない。
- テスト: 完全一致と部分一致、複数特徴、ORとAND、自己名除外、未公開相手手札の参照拒否。

### F02 集合の存在・枚数・比較

PR03更新（2026-10-30）: EXISTS/COUNT/QUERY_CARDS、SOURCE除外、共通filterをsubset.18で実装しました。
対応範囲・UNKNOWN・旧承認の互換性は`card-effect-pr03.md`を参照。以下は当初の提案で、SUM等は未対応です。

- 代表: EB01-012「他の『キャベンディッシュ』がいない」、OP01-039「キャラが３枚以上」。
- 提案: EXISTS、COUNT、SUM、QUERY_CARDS、SOURCE以外という同一個体除外。SUMは必要な参照型だけ後段で公開。
- 改修: Predicate/Selectorの共通探索、範囲上限、元々/現在値の指定。
- 安全性: Count条件のために選択ダイアログを出さない。空欄を0や不在にしない。hidden queryを公開しない。
- テスト: 同名別個体、SOURCE移動後の参照、0/2/3枚の境界、全角「３」は取込の原文を保持し数値パラメータを個別確認。

### F03 手番・原因・状態・成立条件

- 代表: OP10-042「相手の効果で場を離れた時」、EB01-002「相手のアタック時」、ST30-012の登場ターン。
- 提案: TURN_IS、ENTERED_THIS_TURN、CAUSE_MATCH、EVENT_CARD_MATCH、SOURCE_ATTACHED_DON_COUNT。
- triggeredにはtriggerConditionsを新設する案。activationConditions/resolutionConditions/IFと区別する。
- 発生時に固定する値と解決時再評価が必要な値を裁定ごとに記録。全条件を発生時または解決時に統一しない。
- 安全性: effectControllerと選択者を分離。相手が自分で手札を捨てた時も根本の効果操作者を保持する。
- テスト: rule/cost/effect/battle KOの区別、自分効果での移動、相手効果での移動、当時条件と後続の盤面変化。

### F04 MAINの発生元とイベントMAIN

- 代表: ST01-015「【メイン】…KOする」、EB01-020のhand event使用。
- 提案: メイン使用手続USE_EVENTと、承認されたEFFECT_REF。手札からの使用と効果本文の呼出を分ける。
- 改修: compilerのevent×MAIN許可、counterEvents相当の準備処理、matchCoordinator、localServer、UIの発生元token。
- 支払い/使用移動/効果解決/後始末を独立に版管理し、単にhand→trashへ動かせばMAIN発動とはしない。
- 印刷costの扱いとイベントの解決中の領域は公式確認の上で実装。現在のCOUNTER内部手続を根拠なしにコピペしない。
- テスト: cost不足、0cost、他人の手札token、二重使用、効果不成立、使用中の別効果拒否、キャラ/ステージMAINの正しい発生元。

### F05 条件付き誘発と追加timing

- 代表: EB01-021の自ターン終了、OP01-014のBLOCK、OP05-074のDON返却、OP10-042の他キャラ離脱。
- 提案: ON_BLOCK、TURN_START/END、CARD_ENTERED/LEFT、DON_RETURNED等のイベント型と、F03の条件付き候補生成。
- 改修: triggerScheduler、progressionの境界イベント、matchCoordinatorのcheckpoint。共有タイミング/回数制限を複数Effectへコピーして別枠にしない。
- 安全性: 外部socketがeventId/タイミングを作成しない。派生イベントが元の待機群を追い越さない。自分自身の継続評価で無限誘発しない。
- テスト: 両プレイヤー同時誘発、登場/攻撃の二timingで同じターン制限、返却複数枚を何回のイベントと扱うかは裁定確認待ち。

### F06 期間と任意・追加支払い

- 代表: EB05-007の「公開できる：」と「次の相手のエンドフェイズ終了時まで」、EB01-013自己破棄コスト。
- 提案の発動cost: REVEAL_CARDS、MOVE_AS_COST、SELECT_AND_REST等。既存costとの同一カード重複制約を共有する。
- 提案の効果内支払い: OFFER_PAYMENT、IF_PAYMENT_SUCCEEDED。costsへの巻き上げや効果全体optionalでの代用は禁止。
- Duration案: UNTIL_BOUNDARY(player, boundary, occurrence, includeCurrent)。現在のTURN_END/BATTLE_ENDの意味は変更しない。
- 改修: resolutionのchoice/work/pending、支払い計画、effectExpiry、署名/保存フレーム。
- 安全性: 公開cost支払いは本人選択と公開権限を一括確定。返却/破棄/レストの重複資源を二重使用不可。公開が外へ漏れた後に支払いをなかったことにしない。
- テスト: 不足資源、辞退、再送、選択中の古い盤面、公開枚数ちょうど3、後段が不発でも支払いを戻さない。

### F07 効果登場と移動結果の記憶

- 代表: EB01-009「上5枚…登場」、EB01-013「手札から…登場」、EB01-020「戻したキャラと異なる色」。
- 提案: PLAY_BY_EFFECT(cards, destinationSlotPolicy, enterState, provenance)と、MOVE_RESULT/REMEMBER_FACTS。
- 改修: work union、FixtureCoordinator、移動証拠→ON_PLAY、slot選択UI、参照寿命。
- 通常登場のcostチェックを効果登場へ自動適用しない。原文で必要な支払いのみ実施。
- 空き枠不足/既存場カードの処理、手札/デッキ/トリガー保管からの登場は手続を分け、公式未確認なら拒否。
- 移動後の新refを返す時も、自分のeffect結果の当該個体だけに限定。移動前世代の無視や世界中のinstanceId再検索は禁止。
- テスト: 5枠満杯、裏向きライフの自己登場、レスト登場、同名複数、連続ON_PLAY、途中KO、costは自動二重支払いしない。

### F08 DONの操作

- 代表: EB01-002「レストのDON…付与」、EB01-012「DON2枚…アクティブ」、EB01-021「DONデッキから…追加」。
- 提案: SELECT_DON（既存CARDSと整合）、ATTACH_DON、SET_DON_STATE、ADD_DON、RETURN_DON_BY_EFFECT。
- 改修: 既存MovementStoreのattachDon/setRest/moveを用いたwork、DONの所属/付与先検証、原因イベント。
- 安全性: 付与先は許可された場の個体だけ。相手のDON操作は原文がある場合の効果権限であり、UIの相手操作禁止を全面解除しない。
- テスト: active/rest/attached、複数付与先への1枚ずつ、残りDON不足、移動した付与先の世代、返却誘発とcost返却の区別。

### F09 相手手札の操作

- 代表: EB02-045「相手は自身の手札1枚を捨てる」、EB04-022「相手は…2枚を好きな順番でデッキの下」。
- 提案: CHOOSE_OWN_HIDDEN_CARDS(player:OPPONENT, chooser:OPPONENT)、DISCARD_BY_OWNER、ORDER_THEN_MOVE。
- 盲選択/ランダム/本人選択/相手が見て選択は別ポリシー。EB02-045をランダム破棄にしない。
- 改修: resolutionの相対chooser、fixtureEnvironmentの手札権限、viewFor、tokenと順序回答、端末の待機表示。
- 安全性: 効果使用者へ手札cardId・画像・候補token・順序を送らない。ランダムが必要な場合だけサーバーCSPRNGを使用。
- テスト: WebSocket投影/エラー/ログ/再送/観戦を含む漏えい検査、全角条件、手札不足の可能な限り処理と最低支払条件の区別。

### F10 継続効果・ルール変更

- 代表: OP16-080「相手のターン中…コスト+1」、EB01-001「カウンターを持たない…カウンター+1000」、OP17-112「元々のパワー…元々のパワー8000」。
- 提案: CONTINUOUS_EFFECT(condition, affectedQuery, operation)、SET_BASE_STAT/ADD_STAT/GRANT_KEYWORD/RESTRICTを別operationにする。
- 改修: DerivedCardFacts、台帳との合成、盤面更新境界、query/投影/バトル/支払いへの共通適用。
- 差分があるたび全カード全文を再解析せず、承認済み依存項目を索引化して再計算。ただし最初は最大の場カード枚数を上限とした単純評価で十分。
- 依存循環、counterなしと0、元々/現在、複数SETの優先、離れた発生元の影響はRulesetPolicyの確定まで安全停止。評価順をファイル名順にしない。
- テスト: 選択/バトル/画面の同じ値、condition失効で復元、二重適用なし、SOURCE離脱、自己参照循環、取得キーワードと印刷キーワード。

### F11 対象不可・耐性・防止

- 代表: EB03-018「相手の効果でKOされず」、OP03-008「属性(斬)…バトルでKOされない」。
- 提案: CANNOT_TARGET / UNAFFECTED_BY / CANNOT_KO / PREVENT_MOVEという別ポリシー。名称が似ていても同一のfilterにしない。
- 改修: 対象提示前の合法性と実行直前の適用可否を別検査。movementのrule評価をv3へ接続。
- 安全性: 条件をクライアントに委ねない。相手の効果/バトル/ルール/costをcauseで区別。costがpreventされたら正常支払いに見せない。
- テスト: 選べないが効果を受けないものとの違い、対象後に耐性取得、選択後の値変更、ルールによる移動、他人が選ぶ自分のカード。

### F12 置換

- 代表: EB01-008「効果によってKO…代わりに…イベントかステージ…捨てる」、EB03-001「元々のコスト4以上」、EB04-030「代わりにDON1枚を…戻す」。
- 提案: REPLACE_EVENT(match, optionalPayment, substitute, usageScope)。効果発動回数と置換適用回数を別台帳に持つ。
- 改修: 不変の移動意図→適用候補→本人選択/支払い→再評価→MovementStore commitの上層プランナー。
- 現MovementRulesのdeferは例外で止まるので、そのフック内からSocketを待たない。
- 同一意図への適用済み置換IDを記録し循環を防ぐ。候補のどの側がどの順に選ぶかは裁定確認待ちで、実装都合の先着順にしない。
- 安全性: 防止/置換後に元KOを重ねて実行しない。代替で捨てる手札候補を相手へ渡さない。支払い・回数・移動・イベントを原子的に確定。
- テスト: 辞退/不足、costやbattleとeffect KOの区別、同時KO複数個体、競合する置換、選択中に再送、古いintent、KOしていないのにON_KOが出ないこと。

### F13 効果本文の再利用・選択分岐・並列処理

- 代表: ST01-015の「MAIN効果を発動」、EB03-031のtrashイベント本文、EB02-045の「以下から1つ」。
- 提案: CALL_EFFECT_BODY、CHOOSE_MODE、FOR_EACH/SIMULTANEOUS（必要なものを別段階で）。
- 既存IFは条件分岐でありプレイヤーのモード選択ではない。共有本文と使用手続を分け、印刷costを自動再払いしない。
- 安全性: 呼出先は承認済みdefinitionHash/effectIdに限定、循環/深さ/steps/展開数を上限化。ユーザー指定ファイルや動的JS呼出は不可。
- テスト: 元本文の署名/出典対応、同名別版、呼出したカードが移動後も使える根拠、modeの再送、同時/順次で結果が異なる例。

### F14 残るキーワード・攻撃先・ライフ・追加ターン

- 代表: OP06-101のバニッシュ、EB01-038/OP16-080の攻撃先変更、OP05-119の追加ターン、OP17-116のステージKO。
- 提案: RETARGET_BATTLE、CHANGE_DAMAGE_POLICY、EXTRA_TURN、KOの対象種別拡張、phase境界ごとの専用ルール契約。
- 改修: battle/progression、counter/trigger lifecycle、ruleOutcomes、MovementStoreのKO定義。
- 安全性: 追加先/回数/ターンはサーバーが所有。アタック元を変更せず先だけ変更。stageをcharacterに偽装して既存KOへ通さない。
- テスト: ダメージ枚数、ライフ不足、対象途中離脱、ブロック後の変更、勝敗後の後続停止、追加ターンと期限/回数制限の整合。

### F15 カタログ・承認・意味的網羅性

- 代表: 全2,885番号と139差異、P-160/ST30-012/OP06-101のデータ保留。
- 提案: シャードmanifestのroot hash、1カード1定義版、能力文節とEffect/Keyword/Policyの対応レビュー表。
- 原文保存と比較用正規化を分離。カード番号/表示ID/定義版/出典スナップショットを追跡する。
- cards/sourcesの上限は必要な範囲で明示拡張し、無制限スキャンをしない。未承認ファイルを存在だけでロードしない。
- 新しいCompiler/Registry hashへ既存承認を無条件で付け替えない。旧版を保持するか、対象定義を個別に再レビューする。
- テスト: シャード順、重複ID、欠落/差替え、symlink/path traversal、古いhash、未対応能力を落としたカードの拒否。

## 5. 置換を含む処理の中断・再開案

```text
承認済みaction
  -> 意図(intent)生成: まだ盤面は変えない
  -> 発生元/対象/原因/公開範囲を固定
  -> 対象合法性・継続/耐性・置換候補を検査
  -> 必要なら本人だけchoiceを提示して待機
  -> 回答のactor/token/revision/intentHashを再検証
  -> 支払い/置換適用を準備、競合や循環を検査
  -> 最終operationsと台帳を候補状態へ適用
  -> 勝敗/誘発/公開権限/応答を同じ確定点で保持
```

これは単一actionの確定境界です。すべての効果手順を巨大な一括取引へ変えて、途中で見える公開/選択や支払いを消す設計ではありません。
同時と順次は原文/裁定で区別し、低層operations配列の並びに公式の意味を背負わせないようにします。
既に支払って公開された情報を、後段失敗時にロールバックして秘匿へ戻すこともしません。
未確定intent/choiceの保存データは署名対象とし、resume後に二度目の支払い/回数消費/元イベント適用がないことを必須にします。

## 6. 機能依存と停止条件

F15データ保留は全段階の入口です。F01/F02はF03文脈と共通Factsの上に置き、F05/F07/F08/F09へ広げます。
F10継続はF01〜03と期間/値モデルが必要。F11耐性はF03/F10、F12置換はF03/F06/F11とintent機構が必要です。
F04の単純なevent MAINは、継続/置換を必要としない承認カードだけに先行できます。未対応能力を持つ対戦相手との混在は不可です。
F13/F14は独立に難しいので、一つの「汎用アクション」にまとめません。

以下の場合はJSON生成・承認を止めます。

- 原文/枚数/種類が壊れている、差異版の採用根拠がない。
- 成立/解決条件やLKIの扱いが公式資料で確認できない。
- 必要な能力/例外の一部を現行または当該段階の命令で表せない。
- 対象の秘匿性を守れない、Runtime/UIのどちらかが未接続。
- 継続循環/複数置換/追加ターン等のポリシーを推定する必要がある。

## 7. 実装前に確定するもの

新しいノードは小PRごとに名前、必須キー、enum、上限、可視性、場面制約、失敗/不足ポリシーを決めます。
その時点でCompiler・Runtime・Schema・ガイド・承認版・代表シナリオを同時に整えます。
この設計案をそのままChatGPTへ渡して、提案ノードで大量生成させないでください。
まだ実装されていないノードはunsupported/needs_reviewとして外部一覧へ残します。
