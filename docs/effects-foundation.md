# 効果エンジン：基盤フェーズの設計と対応状況

DSLの一部を独立モデルで実行する基盤は [Action実行器](action-runtime.md) を参照してください。draw/move/sequence/repeatの限定対応で、既存対戦には未接続です。

支払い確定と効果処理の境界を管理する独立基盤は [Resolution lifecycle](resolution-runtime.md) を参照してください。DSL実行・既存対戦への接続はまだありません。

後続の独立したターン・フェーズ基盤は [進行管理の設計・対応状況](progression-foundation.md) を参照してください。DSLも進行基盤も、現行対戦への接続はまだ行っていません。

条件だけを評価する独立基盤は [条件評価器の設計・対応状況](predicate-runtime.md) を参照してください。条件評価が追加されても、定義全体のschemaOnly状態や対戦への未接続状態は変わりません。

対象選択の独立基盤は [Selectorの設計・対応状況](selector-runtime.md) を参照してください。候補・選択View・回答検証までを追加し、支払い・移動・効果解決にはまだ接続していません。

複数コストの独立したリソース計画は [Costの設計・対応状況](cost-runtime.md) を参照してください。独立支払いの割当と確定前再検証までを追加し、実際の支払い確定はまだ行いません。

共通移動の独立した状態確定は [Movementの設計・対応状況](movement-runtime.md) を参照してください。独立モデル内の一括確定までを追加しましたが、既存MatchやCost/Resolutionとの接続はまだありません。

## 適用範囲

基準は [利用者提供のv2.0原文](effects-v2-source.md) です。原文は保持し、ここに補足・実装状況を記録します。
「前回仕様書」は未受領のため、確認できる既存テストと既存動作を維持対象とします。

今回追加するのは `server/src/test/effects/` の独立した定義検証基盤です。
既存の通常対戦・一人回し・テスト対戦の実行処理、Socket.IOのイベント、カードマスター読込・CSV形式は変更しません。
サーバー起動時にこのモジュールを自動読込しません。対戦へ接続するコードもありません。

**検証成功は実行可能を意味しません。返却値は常に `status: "schemaOnly"` です。**
今回は発動判定・支払い・移動・効果解決・置換を実行しません。説明用JSONは実カードやマスターへ登録しません。

## 既存コードとの対応表

| 項目 | 既存の状態 | 再利用方針・不足点 |
| --- | --- | --- |
| カード基本情報 | `server/src/test/cardMaster.ts` が起動時読込、対戦ごとに版固定 | 参照元として再利用。DSLとは別に版・対応能力の整合を確認する |
| カード実体 | UUID、種類、レスト、表裏を保持 | UUIDを再利用。移動ごとのgenerationは未実装 |
| ゲーム進行 | 現行対戦は手動移動とアタックの同期 | 独立した手番・ターン・フェーズ・判断者管理を追加。対戦へは未接続 |
| 移動 | `game.ts` のmove分岐 | 将来、共通移動の計画・置換・確定へ分割。今回は変更しない |
| 通信 | actor・revision・requestIdを検証 | 再利用。ただし長時間の選択待ち・解決の保存・要求内容の同一性確認は追加が必要 |
| 非公開情報 | `projectMatch` でプレイヤー別投影 | 再利用。選択ごとの公開権限、不透明な選択ID、非公開ログの投影は未実装 |
| 効果目印 | マスターにeffects/effectIds、説明・timing・対応状況 | 自動効果はまだない。新DSLへの対応付けは今後行う |
| ルームと既存UI | 稼働中 | 今回変更なし |

## 今回のファイル構成

| ファイル | 役割 |
| --- | --- |
| `effects/types.ts` | 判別可能ユニオン、参照、原因、読み取り専用定義、将来用のunknown評価型 |
| `effects/registry.ts` | カテゴリー別の型付き登録・重複拒否・seal・検証コンテキスト |
| `effects/builtins.ts` | 組み込み命令の構造検証と静的ステップ見積り |
| `effects/validation.ts` | JSON安全性検査、参照・変数スコープ検証、上限、読み取り専用化 |
| `test/effects-schema.cjs` | 検証・異常系・拡張性のテスト |
| `test/effects-types.cjs` | 宣言マージとRegistry拡張の型検査。誤ったkind・型がコンパイルで拒否されることを確認 |
| `test/fixtures/effect-schema.example.json` | 架空カードによる構造の例。裁定や実カードの再現ではない |

Registryは Trigger / Predicate / Cost / Selector / Action / Replacement / Modifier / Duration / Restriction の9種類です。
各登録は `kind` に対応するパーサーとステップ見積りを持ちます。登録済み命令の上書きは禁止です。
定義検証を開始するとRegistryをsealし、検証途中・検証後の登録変更を禁止します。拡張は検証前に行います。
実行ハンドラーは今回のRegistryに存在しません。将来もschemaOnlyの登録だけで実行を許可しません。

## DSL v1の検証対象

原文v2.0とDSLの形式番号は別です。今回のDSL形式は `dslVersion: 1` とします。
トップレベルは `dslVersion / effectId / cardId / trigger / costs / actions` が必須、`condition` が任意です。
未定義のフィールドや命令は黙って捨てず、場所付きのDefinitionErrorにします。

| カテゴリー | 構造検証に対応したkind |
| --- | --- |
| Trigger | event（onPlay/onAttack/onKo/turnStart/turnEnd）、activate（main/counter/trigger） |
| Predicate | compare、exists、all、any、not |
| Selector | cards、choice |
| Cost | payDon、moveCards、restCards、revealCards |
| Action | draw、select、move、sequence、if、optional、repeat、modify、installRestriction、installReplacement |
| Modifier | power |
| Duration | thisTurn、nextOpponentTurnEnd、permanent |
| Restriction | forbid（attack/activate/move） |
| Replacement | replaceMove |

比較は EQ / NEQ / GT / GTE / LT / LTE / IN / NOT_IN / CONTAINS に対応します。EXISTSは独立したexists命令です。
数値比較で名前を使うなどの型不整合を拒否します。ただし変数に入る実際の値の型・欠損値の評価は将来の実行器の責務です。
cardsのmodeはSELECT / RANDOM / BLIND_SELECT / ALL / ORDER、CHOOSE_ONE相当はchoiceで表現します。
カード種別・特徴などの条件は候補カードを指すTARGETとPredicateで記述します。
`resolving` は将来のイベントカード解決領域の予約です。現行盤面へゾーンを追加していません。

## 参照と変数

- `literal` は文字列・数値・真偽値・null、またはその配列です。
- `ref` はSELF / OPPONENT / SOURCE / TARGET / EVENT_SOURCE / EVENT / GAME / VARIABLEを明示します。
- 参照フィールドはホワイトリスト方式です。任意のオブジェクトパス、JS式、関数、テンプレート式はありません。
- TARGETはSelectorのcondition/exclude内の候補だけを指します。選択後のカードはsaveAsした変数から参照します。
- selectはカード集合と選択肢を区別します。選択肢をmoveに渡すことはできません。
- 変数は宣言後だけ参照可能です。同じスコープでの再宣言は禁止します。
- sequenceの結果は後続へ引き継ぎます。ifの各分岐、optional、repeat、置換定義の内部変数は外へ漏らしません。
- コスト結果のsaveAsは後続で参照できます。ただしその支払いが成立したかは将来の実行器で検証します。
- 元の入力オブジェクトは変更・freezeせず、検証後の定義をコピーして再帰的にfreezeします。

例は `server/test/fixtures/effect-schema.example.json` を参照してください。
移動先のownerは対象の所有者・コントローラーとの整合を将来の移動器で再検証します。
visibilityは盤面上の表裏の指定であり、相手への公開許可ではありません。手札にfaceUp指定があっても相手へ内容を送る根拠にはしません。

## 安全上限（暫定・アプリのルールではない）

| 項目 | 上限 |
| --- | --- |
| JSON全体 | UTF-8で65,536バイト |
| 構造の深さ | 24 |
| JSON構造の要素数 | 4,096（プリミティブも含む） |
| 配列の長さ | 128 |
| 文字列の長さ | 4,096 UTF-16コード単位。IDなどは別途さらに制限 |
| repeatの回数 | 整数0～20。動的な回数式は今回未対応 |
| 静的な展開ステップ見積り | コストを含め4,096 |

循環・共有オブジェクト参照、getter/setter、非JSON値、NaN/Infinity、疎配列、危険なキーを拒否します。
繰り返しの入れ子・分岐・置換定義の子アクションも見積りに含めます。
この見積りは将来の実行時予算の代わりではありません。イベント再発生・置換連鎖・解決全体の累積予算と時間上限を別途実装します。
拡張命令が子アクションや繰り返しを持つ場合、登録時に見積り関数も必須で定義し、個別にテストします。

## 型付き拡張の契約

TypeScriptの宣言マージでActionMap/PredicateMap/ReplacementMapなどへ新しいkindを追加し、そのkindに一致するパーサーをRegistryへ登録します。
型定義と登録を両方追加し、構造検証・上限・非公開性のテストを用意します。既存kindを別の意味へ変更しません。
拡張コードは信頼するサーバーコードであり、利用者のJSONからパーサーや実行コードを登録しません。
Selectorを拡張する場合は、カード集合/選択肢等の結果型と後続アクションの型契約も追加で設計する必要があります。

## 後続実装で必須の補足仕様

1. ターン・フェーズ・手番・優先権・操作可能プレイヤーをサーバーの正式な状態にする。
2. カード参照をinstanceIdとgenerationで保持する。領域移動時の世代更新・同一オブジェクト扱いを決める。
3. 複数コストをまとめて計画し、同じカード/DONの二重使用を防ぐ。順序付き支払いの依存関係も検証する。
4. 支払い前・確定済み・解決中・選択待ち・完了・失敗を区別する。確定後の任意キャンセルや勝手な巻き戻しを許可しない。
5. selectionIdとresolutionId、選択者、revision、回答済み状態を保持。回答の再送、古い回答、他人の回答を拒否する。
6. 選択時と解決時の双方で対象の世代・位置・必要な条件を確認する。途中で対象が消えた場合の部分解決は裁定に従う。
7. 欠損データをunknownとして伝播する。unknownをfalse/0と取り違えず、自動実行可能と判定しない。
8. 手動操作とルール操作を区別し、選択待ち中の無関係な移動が解決状態を壊さないよう制御する。
9. 永続効果の再計算と期限付き付与効果を別管理し、適用順序・無効・重複・循環依存を定義する。
10. 移動前の置換と成立後のイベントを分離する。無効になった移動からKOイベントを作らない。
11. 解決中に発生したイベントの待機タイミング・同時効果の順序選択・ターンプレイヤー優先の適用範囲を確定する。
12. 不透明な選択ID、公開範囲別のログ、切断・再接続・中断保存の投影を実装する。

これらの型の一部は将来用に置きますが、現在は実装済み機能とは扱いません。

## 未対応・裁定確認事項

未対応：実際の発動可否、支払い、候補生成、ランダム選択、非公開選択、カード移動、効果解決、期限解除、置換、耐性、イベント/ステージ固有進行、KO/ダメージ、自動パワー計算。
また、CSVからDSLへの変換やカードマスターのDSL登録はまだ行いません。

裁定を確認してから実装する事項：同時誘発と処理順序、支払いの順序・置換との関係、対象不在時の部分解決、ゾーン移動時の世代境界、Modifierの適用順、期限の境界、複数置換の適用者と再適用、イベント使用中の領域とトラッシュのタイミング。
本フェーズではこれらを独自のルールで決定しません。

## 実装順序と確認

今回：原文保存、対応表、型、Registry、構造/参照/上限検証とテスト。
次段階：ターン・フェーズ等の状態設計を確定し、Predicate/Selector/Costの実行計画を独立テストで実装。その後、共通移動器・解決・選択待ちへ進みます。
既存対戦への接続は別の段階とし、接続前に手動操作との境界を確認します。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/movement.cjs test/costs.cjs test/selectors.cjs test/predicates.cjs test/progression.cjs test/effects-schema.cjs test/effects-types.cjs test/test-game.cjs test/test-lobby.cjs
cd ..
node --test tools/test-card-master.test.js
npm run build
```
