# PR00・PR01 実装結果と利用方法

実装日: 2026-10-29。基準コミット: `27f4844`。
対象は隔離v3だけです。PR02以降の効果命令・特徴検索・継続・置換等は追加していません。

## PR00: 原資料を保持するレビュー台帳

`server/src/test/effects/v3/reviewLedger.ts`は、既存の監査用ReviewBundleから実行不可の台帳を作ります。

- 生CSVのSHA256、論理レコード番号、カード番号、表示ID、20列のraw原文を保持します。
- 本文/トリガーの完全な組ごとにhash、全レコード、全表示IDを保持。最初の版を正規版に選びません。
- 本文/トリガー以外の基本情報にraw差がある場合も理由を残します。正規化による自動統合なし。
- 種類/数値の不正、表示ID不正・重複、名前不足、監査の異常、本文側の独立したトリガー句等を汎用条件で隔離します。
- 原文の修復や欠けた枚数の推定はしません。P-160等のカード番号による例外処理はありません。
- 台帳全体と各カードは`executable:false`、`reviewStatus:needs_review`。quarantine/review_requiredは台帳専用の区分です。
- effectsやtrusted approvalを生成せず、runtime catalogをimportしません。既存manifestも更新しません。

台帳は既存のReviewBundle/DSLとは別形式の`v3-review-ledger.1`です。
これは新しい**実行DSLのSchemaではありません**。現在のCompilerへ渡すと拒否されます。
review_requiredも承認済み・実行可能という意味ではありません。

### 生成方法

ワークスペースのPowerShellで実行します。

```powershell
npm --prefix server run build
node tools/build-v3-review-ledger.js C:/Users/kensh/Downloads/onepiece_cards_ja.csv local-data/v3-review-ledger-new
```

出力先の親ディレクトリは既存、出力先ディレクトリ自身は未作成である必要があります。
既存の監査を上書きしないため、生成済みなら別の新しい名前を指定します。
UTF-8の厳密デコード、25MiB上限、公式20列形式を検査します。

生成物:

| ファイル | 内容 |
| --- | --- |
| source.csv | 入力の生バイトをそのまま保持。改行/BOM等を変更しない |
| review-ledger.json | 原文全件・版差異・保持理由の実行不可台帳 |
| summary.json | 件数/出典hash。approvedは0 |

生成に失敗した場合、作成途中の新規ディレクトリが残ることがあります。元CSVや以前の監査は上書きしません。
このCLIはローカル監査用です。出力をSocketから読み込ませたり、manifestへ自動登録したりする機能ではありません。
保存JSONに記載されたhashだけで出典を信頼するのではなく、同梱source.csvの生バイトから再計算して照合します。

### 今回の実データ結果

出力: `local-data/v3-review-ledger-pr00-20261029/`（Git対象外）。

| 項目 | 結果 |
| --- | --- |
| 生CSV SHA256 | `cb0695bb48d2d73b4fe5d9931a71e0980be8e7ea7dadbb8bfb4d605b0eb8cb55` |
| rows/cards | 5,058 / 2,885 |
| 本文/トリガー差異 | 139番号、全版保持 |
| quarantine | 155番号。差異/監査/入力異常による保留であり、未対応カード数ではない |
| 新規approved | 0 |
| P-160 | 種類異常で隔離 |
| ST30-012 | 枚数が欠けた版を含む2組を隔離。1枚と補完しない |
| OP06-101 | 本文/トリガーの列差を含む2組を隔離 |

## PR01: EventContext

`server/src/test/effects/v3/readContext.ts`にサーバー内部専用の型付き契約を追加しました。

- effectController: 今解決している効果の操作者。
- chooser: 現在の選択者。選択待ちでなければnull。
- sourceOwner/sourceController: 解決開始時点の発生元の所有者/操作者。
- source: 検証済みの開始時点のref。移動後のカードへ無断追跡しない。
- origin: activation/movement/attack。
- cause: 移動イベントがある場合の元のactor/effectController/source/resolutionId/parentEventId/kind。
- attack: 攻撃イベントがある場合のbattleId/attacker。移動イベントがなければcauseはnull。

`readEventContext`はCoordinatorで既存の発動根拠を検証した**後**に呼びます。
この読み取り関数自体がカード効果を承認したり、入力イベントを正当化したりするわけではありません。
`readContextForCoordinator()`は実際のchoice.chooserだけを付け替え、根本のeffectControllerを変更しません。
役割と原因は不変のスナップショットで保持します。SOURCEが移動した後に古いgenerationから役割を作り直すことはありません。
SocketやviewForのDTOには追加せず、クライアントへ原因中の私的なrefを配信しません。
保存frameの構造・署名・再送契約も変更していません。現在のCoordinatorのサーバー内再開で同じ文脈を使います。
DB永続化/サーバー再起動をまたぐ復旧機能は追加していません。

## PR01: DerivedCardFacts

同じモジュールの`createDerivedCardFactsReader`は、現在の盤面を読む関数を生成します。

```text
reader(cardObjectRef, viewer)
  -> UNKNOWN
  または {
    owner, controller, cardType, rotated,
    printed: { cost, power, counter, life },
    current: { cost, power }
  }
```

- printedは承認済み定義の印刷値。currentは既存のstat台帳、手番に応じた付与DON、既存カウンター加算を用います。
- 値不明/null、古い世代、非公開領域、未知の修正、数値overflowはUNKNOWN。nullを0やcounterなしという新しい裁定に変えません。
- 元のカード定義にあるnullはそのままです。読取契約内で数値として確定しない値をUNKNOWNにするだけです。
- 印刷0は0として保持。costの現在値は従来どおり0未満を0にします。
- viewerに見えない手札/デッキ/裏向きライフは、カタログにそのカードの情報があっても全体をUNKNOWNにします。
- 閲覧権限で見たデッキは本人だけ読めます。権限を閉じた後は再びUNKNOWNです。
- 内部resolvingのカードはゲーム上の領域の値として公開しません。
- 旧master fallbackの数値保証/付与DONによる不明判定も維持しています。

現在のPredicate環境（fixtureEnvironment）の値参照をこの契約へ接続しました。
新しいValue.refやPredicateを公開したわけではありません。
バトル・画面投影の式をこのPRで全面移動したり、手札カウンターを通常表示のpowerに加えたりはしていません。
共通契約ができたことを継続効果やメタデータ検索の実装完了と扱わないでください。

## 互換性

- DSL `3.0.0-subset.16`、Compiler `v3-subset-compiler.16.3`は不変。
- Registry hash `44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763`は不変。
- 既存14枚の定義・原資料・manifest・trusted approvalは変更なし、ロード成功。
- schemas/、通常対戦/一人回しのsrc/、通常サーバーのルーム処理は変更なし。

## 実行したテスト

新規10件を含む、以下のユニークな136ケースが成功しました。

| テスト群 | 件数 | 主な内容 |
| --- | ---: | --- |
| 新規read-context + review-ledger | 10 | 役割、値、UNKNOWN、秘匿、SOURCE移動、古いrevision、版保留、カタログ拒否、上書き防止 |
| 既存audit-effect-cards + compiler + selection-compiler | 31 | 監査、承認、型、未知命令、隠し領域、不正参照 |
| resolution + fixture-coordinator + match-coordinator + reviewed-catalog/setup/entry | 74 | 保存/再開、秘匿、再送、二重支払い、通常登場、14枚、使用制限 |
| attack-effects + ko-effects + counter-events | 15 | 発生原因、参加カード移動、期間、KO、イベント支払い |
| reviewed-server | 2 | 両先攻経路の2クライアント開始→勝敗→同一ルーム復帰 |
| session-serverのlife trigger該当ケース | 4 | 両操作者/発動・非発動、ライフ秘匿、内部保管の後始末 |

通信テストの初回は制限環境のlocalhost接続でタイムアウトしました。同じコードをローカル通信許可環境で再実行し、2件とも成功しました。
サーバー/フロントのビルド成功。フロントは従来の500KiB超チャンク警告のみです。
実機iPhoneのUI試験は実施していません。新しいUIは追加していません。

## 次へ進む条件

PR00/PR01の範囲は完了です。PR02のメタデータ条件実装へ進むための土台はありますが、今回はここで停止します。
特徴/名称/色/属性/能力タグ、集合Predicate、新timing、継続、効果登場、置換、任意支払い等はすべて従来どおり未対応のままです。
台帳の隔離解除・差異版採用・新カードの独立承認・公式裁定の確認は別作業です。
