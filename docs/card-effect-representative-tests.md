# 代表カードの意味分解・テスト計画

PR05b更新: 合成イベントで公開対象/本人手札/相手による公開対象選択を検証しました。
ST01-015のMAINに必要な選択/KOの核は検証しても、未対応TRIGGER本文呼出を省略してカード全体を承認しません。詳細は`card-effect-pr05b.md`。

PR05a更新: 実カードの追加承認なし。単純イベントMAINを合成fixtureで検証し、ST01-015の全能力/対象選択を対応済みにはしません。
検証範囲と結果は`card-effect-pr05a.md`を参照してください。

PR04更新: 実カードの追加承認はせず、単純なcharacter/stage MAINを合成fixtureで検証しました。
既存Kid MAINも回帰確認。結果は`card-effect-pr04.md`、テストは`v3-main-sources.cjs`と`v3-session-server.cjs`を参照。

基準: `0cd0883` / 入力CSV SHA256 `cb0695bb48d2d73b4fe5d9931a71e0980be8e7ea7dadbb8bfb4d605b0eb8cb55`。
この文書は新規テストの計画です。未実装機能のテストを実行済みとは扱いません。

進捗更新: PR02ではT04の名前除外/特徴選択と、T18のTRIGGER保持条件の部分を合成カードで検証しました。
全カードの完成やT18の継続/攻撃先変更を実装したわけではありません。実行結果は`card-effect-pr02.md`、テストは`server/test/v3-metadata.cjs`を参照してください。
引用は入力CSVの本文です。全版のレコードと差分は[監査](card-effect-coverage-audit.md)を参照してください。

## 1. シナリオの形式

各テストは以下を持つことを提案します。カード専用のRuntime分岐ではなく、入力/期待値としてカード番号を使います。

| 項目 | 内容 |
| --- | --- |
| 出典 | cardId、表示ID、原文/trigger、recordNumber、dataset/hash、採用版、公式Q&A/規則の版 |
| 能力分解 | 発生timing、成立条件、発動可否、解決条件、cost、選択、action、期間、置換/例外 |
| 初期状態 | 2人の領域、個体/世代、DON/手札/ライフ、手番/phase/battle、台帳 |
| 操作 | 使用者、本人選択、支払い、回答順、再送/古いrevision等 |
| 期待結果 | 公開盤面、各側だけが見る投影、cause/移動前後/誘発、期限と回数 |
| 根拠の状態 | current_verified / design_only / ruling_required / source_hold |

以下の代表はカード全文を確認して分解したものですが、成立条件がどの時点で必要か等の裁定は未確認ならruling_requiredにします。
表の「条件候補」は原文の条件句を指し、解決時IFへの自動変換を認めるものではありません。

## 2. 既存対応の対照群

### T01 OP01-033 イゾウ

- 分解: 自身ON_PLAY、追加costなし、相手characterの現在cost4以下、0〜1枚、REST。継続/置換なし。
- 状態: 既存承認/current_verified。
- 期待: cost4は選択可、5は不可、0枚で変更なし、既にrestでもactiveへ反転しない。
- 検査: 相手回答拒否、候補token秘匿、work再送で二重適用なし。
- 既存根拠: `server/test/v3-reviewed-entry.cjs`。

### T02 OP01-054 X・ドレーク

- 分解: 自身ON_PLAY、相手のrest character・cost4以下、0〜1枚、EFFECT_KO。
- 状態: 既存承認/current_verified。
- 期待: activeのcost3は選べず、restのcost4はKO。付与DONがあればREST DONへ戻る。単なるtrash移動は同じKO証拠を出さない。
- 既存根拠: v3-reviewed-entry、v3-ko-effects。

### T03 ST02-001 ユースタス・キッド

- 原文: 「③…自分の手札1枚を捨てることができる：このリーダーをアクティブにする」。
- 分解: MAIN、SOURCE_OBJECTターン1回、DON3rest+hand1discard、SOURCEをactive。
- 状態: 既存承認/current_verified。
- 期待: active DON2またはhand0なら何も払わず開始拒否、支払い成立で1回消費、同じ要求の再送は二重消費しない。
- 既存根拠: v3-reviewed-catalog/setup。任意支払いが0件という一次分類への反例。

## 3. メタデータ・集合・成立条件

### T04 OP01-016 ナミ（PR02）

- 原文: 「『ナミ』以外の特徴《麦わらの一味》を持つカード1枚まで」。
- 分解: ON_PLAY→上5枚を本人確認→name除外AND trait→0〜1公開/hand→残り任意順でdeck bottom。追加costなし。
- 不足: name/trait filter。成立条件はなし。残りの閲覧/公開範囲を維持。
- 期待案: 同特徴でも名前ナミは除外、複数特徴の1つに一致すれば候補、0枚なら公開workなし。選んだ1枚だけ両者公開。残り順序は相手非公開。
- 境界: deck1〜4、途中deck emptyによる勝敗、選択/並べ替えの再開、表記版の違い。カードの裁定確認後に承認。

### T05 EB01-012 キャベンディッシュ（PR03/06/09）

PR03: 同名他個体の不在条件の核のみ`server/test/v3-query.cjs`で検証済み。全能力/版差異/裁定の保留は解除しません。

- 原文: 「【登場時】/【アタック時】…他の『キャベンディッシュ』がいない場合…ドン!!2枚までをアクティブ」。
- 分解: 2timing、leader trait超新星、同名SOURCE以外の自character不存在、DON0〜2active。
- 不足: metadata、EXISTS否定、DON状態変更、条件の評価時点。
- 期待案: 自身だけと同名別個体ありを区別。他方プレイヤーの同名カードは自集合へ数えない。既にactiveのDONの扱い/対象候補は公式確認。
- 状態: ruling_required。2timingを2つの別効果へ分ける場合の共有制限も原文に従う。

### T06 OP01-039 キラー（PR03/07）

PR03: character集合の0/2/3/4枚・SOURCEを含む条件の核のみ検証済み。ON_BLOCK/DON/誘発評価時点は未対応のままです。

- 原文: 「【ドン‼×1】【ブロック時】自分のキャラが３枚以上いる場合、カード1枚を引く」。
- 分解: attached DON条件、ON_BLOCK、character count>=3、DRAW1。
- 不足: blockイベント、集合枚数、DON成立条件。全角数字の原文を保持。
- テスト: 2/3枚、DON0/1、単にrestにしただけでは誘発しない、ブロック後の他効果で枚数が変わった場合の評価時点を確認。

### T07 OP10-042 ウソップ（PR03/06/12）

- 分解A: 自コスト2以上・traitドレスローザの全characterへ継続cost+1。
- 分解B: 相手ターン/ターン1回、該当traitの他characterがKOまたは相手効果で離れた時、hand<=5ならDRAW1。
- 不足: 継続Query、他カード監視、原因、使用回数、条件時点。
- source_hold: 文順が異なる2版を統合しない。1行のOR条件へ自動変換しない。
- テスト: battle KO、自効果移動、相手効果bounce、ルール処理、同時複数離脱、hand5/6、当該カードの移動前cost。

## 4. イベント・効果登場・記憶値

### T08 ST01-015 ゴムゴムのJET銃（PR05/15）

- 分解: EVENT MAIN、相手power6000以下0〜1character KO。TRIGGERは「このカードの【メイン】効果を発動」。
- 不足: MAIN使用と共有本文呼出。既存KO部分だけ対応済みでカード全体を承認しない。
- テスト: 印刷cost不足、power6000/6001、期限付きpower修正、0枚、MAINとTRIGGERの支払い差は公式確認待ち。
- 状態: design_only/ruling_required。TRIGGERからMAIN本文をコピーしてcostを再請求しない。

### T09 EB01-009 うるせェ!!!いこう!!!!（PR02/08）

- 分解: COUNTER→上5枚→cost<=3 AND trait動物 AND character→0〜1effect play→残り順序を選びbottom。
- 不足: trait filter、閲覧したdeckからの効果登場。通常登場costとの区別。
- テスト: cost3/4、候補0、満杯5枠、登場後ON_PLAY、途中の勝敗、相手へ選ばなかったカードを漏らさない。

### T10 EB01-013 光月日和（PR08/10）

- 分解: MAIN、自身をtrashへ置く発動cost、handから自身の名前以外/cost<=5/traitワノ国character0〜1登場、その後DRAW1。
- 不足: MOVE_AS_COST、metadata、PLAY_BY_EFFECT、SOURCEの移動後に処理を継続する根拠。
- テスト: 自己cost成立後のSOURCE世代、候補なしでも後段drawするかは原文/公式確認。costのtrashはON_KOにしない。ドロー後に古いSOURCEを再使用しない。

### T11 EB01-020 シャンブルズ（PR05/08/15）

- 分解: leader trait超新星→自character1枚bounce→戻した個体と異なる色のcost<=2hand character0〜1登場。TRIGGERはMAIN本文。
- 不足: 色の記憶値、MAIN、効果登場、本文呼出。
- テスト: 多色同士の「異なる色」の意味は要裁定。戻した個体が手札に入った後の選択可否、対象不在、世代、手札の他カードの秘匿。元色を現在の別カードから読まない。

### T12 EB03-031 ヴィンスモーク・レイジュ（PR06/15）

- 分解: 自ターン/ON_PLAY、DON-1、leader名サンジ、trashのevent cost<=7のMAIN効果を発動。
- 不足: 別カードの本文呼出、発生/解決条件、呼出先発生元。event通常使用とは別。
- テスト: 呼出先のMAIN/COUNTER区別、hash/版固定、選択先移動、MAIN本文の発動条件/印刷cost、再帰。いずれも裁定確認の前に結果を決めない。

## 5. 支払い・選択・相手手札

### T13 EB05-007 モネ（PR02/07/10）

- 分解A: ON_PLAY、handのevent OR traitパンクハザードを合計3枚公開するcost→DRAW1。
- 分解B: 自ターン終了時、SOURCEに次の相手エンドフェイズ終了までpower+5000。
- テスト: typeのみ/traitのみ/両方一致のカードは二重に数えない。2枚しかなければ払えず、3枚公開で手札は減らない。相手は公開したカードだけ見える。
- 期限: endステップに入った時と終わった時を区別。現在のTURN_ENDの適当なoccurrenceで代用しない。

### T14 EB02-045 トラファルガー・ロー（PR10/11）

- 分解: BLOCKER、ON_PLAY、trash2枚を任意順bottomへ払う、mode選択「DRAW1」または「相手hand>=5なら相手本人がhand1discard」。
- 不足: 順序付きcost、CHOOSE_MODE、相手本人の手札選択。
- テスト: 複数trash候補の順序、cost不足、本人hand5/4、選択待ちの操作者移動、相手端末の候補/画像/順序token漏えいなし。
- 注意: 相手手札をランダムに捨てる試験とは別。

### T15 EB04-022 イッショウ（PR03/10/11）

- 分解A: ON_PLAY、自分hand2discard cost、相手hand>=6なら相手本人が2枚任意順bottomへ。
- 分解B: DON×1/ON_ATTACK、自分hand1discard cost→相手character0〜1にpower-2000このターン。
- テスト: 相手の6/5境界、選んだ2枚の順序は相手に漏れない、発動者の支払ったtrashは公開、両能力を省略せず対応。
- 成立条件と解決条件の配置は公式確認後に固定。

## 6. DON・継続・攻撃先

### T16 EB01-002 イゾウ（PR02/06/09）

- 分解A: ON_PLAY、自leader/character1枚へrest DON0〜1attach。
- 分解B: 相手ON_ATTACK/ターン1回、hand1discard cost、leader traitワノ国OR白ひげ海賊団、相手leader/character0〜1にこのターンpower-2000。
- テスト: DONは1個体を2先へ付与しない。根本効果操作者と攻撃者を分離。私的手札の選択を攻撃者へ送らない。条件変化/回数/辞退を確認。

### T17 EB01-021 ハンニャバル（PR03/07/09/10）

- 分解: 自ターン終了、自cost>=2/traitインペルダウンcharacter1枚をhandへ戻すcost、DONデッキから0〜1active追加。
- 不足: 終了誘発、移動cost、DON追加。一次抽出の追加timingに漏れた代表。
- テスト: 自身がleaderでも自characterを選ぶ。付与DON返却と追加DONを区別。返却cost後の不発を巻き戻さない。

### T18 OP16-080 マーシャル・Ｄ・ティーチ（PR02/06/09/12/16）

- 分解A: 相手ターンの間、自characterすべてcost+1（継続）。
- 分解B: 相手ON_ATTACK/ターン1回、TRIGGER保持hand1discard cost→攻撃先をSOURCE leaderまたは自trait黒ひげ海賊団characterへ。
- テスト: 元々/current cost、ターン変化、場へ新規登場したカードにも継続適用、SOURCE離脱。攻撃元は維持、先だけ更新。捨てるカードのTRIGGERは発動しない。
- 状態: 実装不足が多いため、最初の試験カードにはしない。

### T19 EB01-001 光月おでん（PR02/03/07/12）

- 分解A: 自traitワノ国・counterなしのcharacterカード全体へcounter+1000というルール上の変更。
- 分解B: DON×1/ON_ATTACK、cost>=5 traitワノ国の自character存在なら、次の自ターン開始までSOURCE power+1000。
- テスト: counter:nullと0、手札/場等どこに及ぶかを公式確認、印刷counterありへの非適用、次開始境界、追加ターン時の扱い。
- ルール上の元値変更を一時MODIFY_STATで代用しない。

### T20 OP17-116 震御雷（PR05/10/12/16）

- 分解: MAINにDON2rest cost→相手stage0〜1KO。COUNTERは自TRIGGER保持character>=2なら自leader/character0〜1にBATTLE_END power+4000。
- テスト: stage KOをcharacterとして偽装しない。2種類の使用手続とcostを区別。TRIGGER保持条件がライフ発動へ混入しない。

## 7. 防止・置換・複雑なルール

### T21 EB01-008 リトルオーズJr.（PR14）

- 分解: ターン1回、SOURCEが効果KOされる場合、代わりに自hand event OR stage1枚discardできる。
- テスト: battle KOでは候補なし、自他の効果KOの範囲は本文/裁定で確認、候補なし/辞退/承諾、handの他カードを漏らさない。
- 期待案: 置換成立なら元KOが出ずON_KOも出ない。手札破棄と適用回数は一度だけ。
- 競合置換・同時KO・支払い後の再検証はruling_required。ON_KO後に復活させる実装は不可。

### T22 EB03-001 ネフェルタリ・ビビ（PR12/14）

- 分解A: ターン1回、自original cost>=4 characterのKOをhand1discardで置換。
- 分解B: MAIN、leader rest cost、相手character0〜1power-2000、その後自ON_ATTACK能力を持たないcharacter0〜1にこのターンRUSH。
- テスト: original/current cost差、他個体のKO、ターン共有回数、能力タグが取得/印刷のどちらを含むか要確認。片方だけ実装してカード全体を承認しない。

### T23 EB04-030 カイドウ（PR06/09/14）

- 分解A: SOURCEのKOを自場DON1返却へ置換。
- 分解B: ON_PLAY、DON-2 cost、leader trait百獣海賊団ならこのターンRUSH、その後相手cost<=7 character0〜1REST。
- テスト: 自己置換で返したDONと登場costの返却は別。前半条件不成立時の「その後」の範囲は公式確認。複数処理の適用済みintentを再実行しない。

### T24 EB02-030 仲間の夢を笑われた時だ!!!!（PR12/14）

- 分解: COUNTERで自character全体へこのターンbattle KO時のhand1discard置換を付与。TRIGGERはDRAW1。
- テスト: effect KOには適用しない、付与時点の集合か後続登場も含むかは公式確認、複数個体/複数付与/残りhand、期限切れ、元eventがtrashでも付与存続。
- 期間付きGRANT_KEYWORDで表せるとはしない。

### T25 OP05-119 モンキー・D・ルフィ（PR16c）

- 分解: ON_PLAY/DON-10、自身以外の全自characterを任意順bottom→追加自ターン。MAIN/ターン1回/DON1rest→DON1active追加。
- source_hold: 支払い句の3版差、追加ターン/並列か順次か/期限/回数の意味を別途確認。
- テスト: 追加ターンの順番、1回制限のリセット、両者期間修正、0枚移動、最後のカード移動と勝敗。後段へ回して未対応を維持可能。

## 8. データ異常の非実行テスト

| ID | 入力 | 必須結果 |
| --- | --- | --- |
| T26 ST30-012 | 「ドン!!枚」と「ドン!!1枚」の版 | 採用版の根拠なしに1と補完しない。source_hold |
| T27 OP06-101 | トリガーが本文へ混入した版 | 両版の原文/列を保持し、修復候補を別記録。自動approved不可 |
| T28 P-160 | 種類がキャラクタークター、タグが【トリガー 】 | 型を推測補正せずdata_hold。原資料を再取得/確認 |
| T29 OP14-087 | デッキ/自分のデッキ、特徴部分一致 | 所有側補完や全文NFKC正規化を承認根拠にしない |

## 9. 全ケース共通の負例

- 同じcardIdの別版/別個体、古いgeneration、他ルーム/他人のtoken。
- 同じrequestIdの再送と、内容だけ変えた再送。途中で接続が切れた場合の安全停止。
- 0枚/不足枚数/上限超え。効果の可能な限り処理と支払いの必要枚数の違い。
- 発生/発動/支払い/解決の各時点で条件が変わる場合。
- 相手視点のJSON、ログ、choice、エラーへ隠しcardIdや順序が漏れないこと。
- 割込み中の通常操作/ターン終了拒否、choice復元後の二重work/二重誘発なし。
- 勝敗確定後に残りactions・置換・通常phaseを実行しない。
- 同時移動と順次移動、原文の「その後」「場合」の係り方を勝手に同一視しない。

## 10. 現在実行できる軽量確認

```powershell
npm --prefix server run build
node --test server/test/v3-reviewed-entry.cjs
node docs/validate-card-effect-json.cjs --examples docs/card-effect-json-examples.json
```

これらは既存対応の回帰と既存サンプルのCompiler確認です。T04以降の新機能を実装/検証したことにはなりません。
新しいシナリオ期待値を公式根拠で固定できない場合、テストを緑にするために推測値を入れず保留にします。
