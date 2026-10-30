# 効果JSON生成に関する実装状況

更新: PR04 / 2026-10-30。基準`d6df2d4`。MAIN入口は`card-effect-pr04.md`、集合条件は`card-effect-pr03.md`、メタデータは`card-effect-pr02.md`。
対象は隔離v3エンジン。通常対戦・一人回し・旧効果スキーマと混ぜないでください。

## 対応段階の区別

| 層 | 状態 | 注意 |
| --- | --- | --- |
| JSON構造 | 新集合条件は`3.0.0-subset.18` / Compiler `v3-subset-compiler.18.1`。旧16/17を併存 | 旧承認のhashを変更しない。SchemaだけではCompilerと同等にならない |
| Registry | 新18は44命令・9カテゴリー。旧17は41命令、旧16は38命令（replacementは空） | 対応profileを明示して使用 |
| 解決機械 | 選択・支払い・work待ち・保存データからの再開を実装 | 本番DB保存/ネットワーク再接続復旧ではない |
| 盤面適用 | 限定的な移動・修正・キーワード・誘発・バトル | 実行時の領域/所有者/世代/非公開情報チェックあり |
| 実カード | 14種類、指定プリセットのみ独立承認 | 生成JSONを配置しただけでは使用不可 |
| 画面・Socket | 限定実カード試合、先後・マリガン・勝敗まで接続。MAINはleader/character/stageの個体別tokenと中央ダイアログ | 発動元/世代/効果/revisionをサーバー再検証。イベントMAINは未対応 |

## 実装済み（限定範囲）

- Predicate: all/any/not/compare。lifeCount/handCount、SOURCE/CANDIDATEのcost/power/cardType/rotated、束縛枚数。
- 新17のPredicate: CARD_NAME、CARD_METADATA、HAS_ABILITY。名前・特徴・色・属性のliteral/集合条件、印刷/付与/現在の能力タグ。既存のAND/OR/NOTと合成。
- 新18: EXISTS、COUNT、条件専用QUERY_CARDS。公開領域と自分手札の単一領域を対象とし、Selectorと共通評価。SOURCE除外、cost/powerの明示printed/current参照。UNKNOWNは0/falseにしない。
- PR00/01: 実行不可レビュー台帳、EventContext、権限付きDerivedCardFacts。新Predicateも同じFacts/evaluate経路を使用。
- PR04: MAIN発動元をサーバー列挙し、カード個体/effectId/tokenで選択。可否preflightと既存の支払い・解決機構を分離。通常対戦・一人回しは対象外。
- 発動コスト: REST_DON、REST_SOURCE、DISCARD_HAND、DON_RETURN。複合支払いの重複を検証。
- 選択: 公開の場/trash/public、自分手札、自分active/rest/attached DON、自分が見たデッキ上の集合。
- アクション: 命令一覧JSONの15種。移動・KO・REST・SET_ACTIVE・DRAW・サーチ/公開/順序・分岐等。
- 修正: power/costの期間付き増減、BLOCKER/RUSH/RUSH_CHARACTER/CANNOT_BE_BLOCKED付与。TURN_END/BATTLE_ENDで失効。付与先はleader/character、leaderへのRUSH系付与は不可。
- 誘発: 自身のON_PLAY/ON_ATTACK/ON_KO、場のON_OPPONENT_ATTACK。条件付き誘発成立の判定は未対応。
- カウンターイベントとライフトリガー: 追加発動コスト等がない限定形式。
- バトル進行・手札カウンター・ブロック・ダメージ・デッキ切れ/ライフ0へのダメージによる勝敗。
- 原資料と定義・Compiler・Registry・Rulesetのハッシュを照合する独立承認。

## 未実装・部分対応

| 機能 | 実際の制限 |
| --- | --- |
| メタデータ条件の未対応範囲 | 任意個体を指定する参照、メタデータ変更効果、公式名称alias、正規化による同一視は未対応。公開leader等の集合Queryは新18で対応 |
| 未知の能力タグ | DOUBLE_ATTACK等は未対応。存在しないものとしてfalseにせずCompilerで拒否 |
| 集合条件の未対応範囲 | 複数領域の合算COUNT、SUM、ネストQuery、deck/life/相手手札/DONのQueryは未対応。条件付き誘発成立の解禁もしない |
| 自分ターン/登場ターン/原因の条件 | 汎用Value/Predicateなし。MAINのタイミング制約は自分ターン条件の代用ではない |
| 条件付き誘発成立 | triggeredのactivationConditionsは空all必須。解決時IFへ勝手に変更不可 |
| 継続効果 | 常時条件の再計算・常時ModifierRegistryなし |
| 置換/KO耐性/効果を受けない/対象不可 | replacement登録0件。Movementの低層機能をDSL対応と見なさない |
| イベントMAIN | Compilerと使用経路とも未対応 |
| 相手の非公開手札の盲選択/ランダム破棄 | 未対応。自分手札選択で代用不可 |
| 効果によるDON付与/アクティブ化 | 通常操作のattachDonはあるがDSLアクションはない |
| 効果による登場 | MOVE_CARDのdestinationにcharacter/stageなし。手札からの通常登場と別 |
| 発動後の任意支払い/手札公開コスト | costsは発動前。任意支払い命令なし、公開をコストとして定義する命令なし |
| KO前のSOURCE値やKO時追加コスト | 未対応。KO後のBIND_SOURCEは可能だが別の意味 |
| トリガー自身の移動/登場 | SOURCE値/BIND_SOURCE不可。内部保管→既定trashのみ |
| ターン開始/終了/ブロック時などの独自timing | Registryにない。新規文字列の追加だけでは実行不可 |
| 名称単位のターン1回・対戦1回 | PER_TURN/SOURCE_OBJECTのみ |
| 2885種類の一括配備 | reviewed manifestはcards/sources各128件上限。現状の14枚向け入口のまま大量配備できない |
| 全能力の意味的対応検証 | Compilerは本文の意味を読まない。人による網羅確認が必要 |

## 旧資料との差異・紛らわしい実装

`server/src/test/effects/registry.ts`はtrigger/modifier/restriction等を持ちますが、entry.statusは`schemaOnly`です。
`server/src/test/effects/v3/compiler.ts`の実行接続済みsubsetと同じ語彙ではありません。
以前渡されたv2/v3概念DSLの`trigger`、`modifiers`、`replacement`等を混ぜないでください。

`cardData.ts`のReviewBundleは監査用でeffectsが空配列限定です。
`requireExecutableV3Card`や`ApprovedV3Catalog.requireExecution`は常に例外を投げる旧入口です。
実際の限定実カード実行は`loadReviewedV3Catalog`→ブランド付き承認カード→`V3SyntheticMatchCoordinator`/`V3FixtureCoordinator`です。
これらの例外メッセージだけで「v3 runtime全体が未実装」と判断するのも誤りです。

## 実装中の扱い

この調査時点で、生成者が利用可能な「半実装だから試してよい」命令はありません。
構想・Registry空枠・schemaOnlyは未対応として隔離してください。
段階7/8の予定は実装済みの証拠ではありません。
通常対戦や公開サーバーに大量JSONを自動追加する取込処理もありません。
