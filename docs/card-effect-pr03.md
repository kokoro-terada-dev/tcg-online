# PR03: 条件専用のカード集合

実装日: 2026-10-30。基準コミット: `4659b2c`。
隔離v3だけを変更し、通常対戦・一人回し・新カードの承認には変更を加えません。
PR04以降へは進みません。

## DSL

新Schema `3.0.0-subset.18` に以下を追加しました。

| Category | Node | 必須パラメータ |
| --- | --- | --- |
| predicate | EXISTS | query |
| predicate | COUNT | query, op, value |
| query | QUERY_CARDS | owner, controller, zone, visibility, faceUpOnly, cardTypes, filters, excludeSource |

各ノードの任意メタデータは既存の`id`/`sourceSpan`です。
COUNTの`op`は`eq/ne/lt/lte/gt/gte`、`value`は整数0〜256。負数、小数、文字列、範囲超過は拒否します。
COUNTはスカラー値ノードではなく、枚数と整数を直接比較するPredicateです。
EXISTSは同じ集合の正確な枚数が1以上かを判定します。

```json
{
  "type": "COUNT",
  "op": "gte",
  "value": 3,
  "query": {
    "type": "QUERY_CARDS",
    "owner": "SELF",
    "controller": "SELF",
    "zone": "character",
    "visibility": "PUBLIC",
    "faceUpOnly": true,
    "cardTypes": ["character"],
    "filters": { "type": "all", "conditions": [] },
    "excludeSource": false
  }
}
```

同名の別個体の不存在は`not(EXISTS(query))`または`COUNT(query,eq,0)`。
queryの`filters`を`CARD_NAME/CANDIDATE/PRINTED/eq/キャベンディッシュ`、`excludeSource:true`にします。
名前はカードJSONに記述したliteralです。カード番号専用の分岐や、名前の暗黙のSOURCE参照はありません。
全文の合成CardDefinitionは`card-effect-query-examples.json`に3件あります。
実カードの全能力を表す例ではなく、条件部分を既存MAIN/DRAWで検証するための足場です。

## 対象範囲と共通評価

- `owner/controller`: SELFまたはOPPONENT。SELFはEventContext.effectControllerであり、選択者やカード所有者とは区別します。
- 1queryにつき1領域。公開の`leader/character/stage/trash/public`は`visibility:PUBLIC,faceUpOnly:true`。
- 自分の`hand`のみ`owner/controller:SELF,visibility:OWNER_ONLY,faceUpOnly:false`。相手手札・deck・life・resolving・DON領域は未対応としてCompiler拒否。
- `cardTypes`: leader/character/stage/eventの空でない重複なし配列。characterだけ指定した集合にleader/stageは入りません。
- `filters`: PR02のCARD_NAME/CARD_METADATA/HAS_ABILITYと、既存compare/all/any/notをそのまま再利用します。
- Queryのスコープは既存CARDS parserへ委譲し、候補列挙も既存Selectorと共通です。フィルターの実体は同一のevaluate/DerivedCardFactsです。
- queryカテゴリーはSELECTのselectorではありません。min/max/chooser/bindAs等は受け付けず、UI・束縛・選択tokenを作りません。
- `excludeSource:false`ではSOURCEも条件に合えば数えます。trueではinstanceIdとgenerationの両方が一致するSOURCEだけを除外。
- SOURCEを除外する場合、元のrefが現時点でも有効であることが必要です。場を離れてgenerationが変わった個体へ追随しません。ON_KO/TRIGGERでのSOURCE参照解禁もしません。
- 複数領域はall/any/notで独立したPredicateを合成できますが、領域横断の合算COUNTは今回未対応です。

新18では数値Valueに`SOURCE.printed.cost/power`、`SOURCE.current.cost/power`、`CANDIDATE.printed.cost/power`、`CANDIDATE.current.cost/power`も追加しました。
既存`SOURCE.cost/power`、`CANDIDATE.cost/power`は従来どおり現在値です。
新Valueは既存compareで使用でき、CANDIDATEはfilter内だけ。旧16/17は新Valueを拒否します。
名前・特徴・色・属性のPRINTED/CURRENT、能力のPRINTED/GRANTED/CURRENTはPR02と同じです。
正規化・表記alias・部分一致の意味も変更していません。

## UNKNOWNと秘匿

空の、読み取り可能な集合はCOUNT=0、EXISTS=falseです。
一方、参照不能・古いSOURCE・非公開/裏向きの公開候補・不明な必要Factsが含まれる集合はUNKNOWNです。
不明候補を捨てて「0枚」や「不存在」とはしません。既知の一致候補があっても不明候補があれば保守的にUNKNOWNを維持します。
all/any/notは従来の三値論理のままです。機械が確定結果を必要とする箇所は既存のunknown-predicate停止経路を使います。
そのadvanceが失敗した場合は原子的に不変ですが、それ以前に完了した別workの巻戻しを意味しません。

Queryの参照や列挙結果、件数はサーバー内に留まり、Socket DTO・choice.optionsへ追加しません。
自分手札を調べても相手の投影は匿名カードのままです。通常の効果結果から条件の成否が分かる場合と、非公開の候補IDを送信することは別です。
公開不可の集合は空であってもサポートしません。未閲覧デッキ/ライフ/相手手札を0扱いして権限を迂回できません。
Query内に別のQueryを入れる記法は、探索量と参照文脈を曖昧にしないためCompiler拒否します。SUM、動的閾値、任意カードへの参照も公開していません。

## 版と承認

| Schema | Compiler | Registry hash | 登録数 |
| --- | --- | --- | --- |
| 3.0.0-subset.16 | v3-subset-compiler.16.3 | 44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763 | 38 |
| 3.0.0-subset.17 | v3-subset-compiler.17.1 | d18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9 | 41 |
| 3.0.0-subset.18 | v3-subset-compiler.18.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 | 44 |

新18は9カテゴリー（query追加、replacementは空）。新3命令はすべてhandlerVersion=1です。
旧16/17ではqueryカテゴリー自体を登録しないため、Registry hashは完全維持します。
frameは従来のv3-frame.9のまま、定義・Compiler・Registry・rulesetのpinで異なるプログラムを分離します。
既存14枚の定義・source・manifestは未変更。Schemaだけ18へ変更しても旧approvalを再利用できないことを全14枚で検査しました。
今回の架空fixture承認はテスト内だけで、実行カタログには追加しません。

## 代表条件と保留

出典の条件断片は既存`card-effect-representative-tests.md` T05/T06、差異は`card-effect-coverage-audit.md`を維持します。

- EB01-012: 自身だけ/自分の同名別個体/相手の同名/SOURCE移動後/幅・記号差を両座席で検証。DON操作、leader特徴条件との完全な結合、複数timingとその条件成立時点は未対応/裁定確認のままです。139番号の版差異も採用しません。
- OP01-039: character集合0/2/3/4と、SOURCEがcharacterなら含むことを検証。原文の「自分のキャラ」を種類で数え、暗黙の自身除外をしません。ON_BLOCK、付与DON条件、誘発条件を評価する正確な時点は未実装で、このテストから確定しません。
- 複合: cost<=3かつ特徴、指定名以外かつ特徴、能力タグ>=2、同名他個体=0、色/属性、印刷値と現在値の差を検証。

両代表カードとも完成した効果JSONや承認を追加していません。不明な裁定を条件ノードの実装から逆算しません。

## 確認結果

- 新Compiler/Runtime: `server/test/v3-query.cjs` 26件成功。
- 新Schema/命令表: `tools/test-v3-query-schema.test.js` 3件成功。Ajv 8有効、skipなし。全文例3件と負例13種類を検証。
- 既存PR00/01/02、解決・支払い・選択・14枚・Socket・ライフトリガー等157件成功。
- 合計186件成功、失敗0、skip0。Schema未導入環境ではSchemaテストが明示skipになるため、成功扱いにしません。
- サーバー/フロントbuild成功。フロントは既存の500KiB超チャンク警告のみ。
- iPhone実機UI試験、新カード承認、全カードの意味的検査、本番DB復旧は未実施です。

```powershell
npm --prefix server run build
node --test server/test/v3-query.cjs
node --test tools/test-v3-query-schema.test.js
node docs/validate-card-effect-json.cjs --schema --examples docs/card-effect-query-examples.json
npm run build
```

Schema検証には生成ガイドと同じ一時Ajv 8用NODE_PATHを設定してください。ゲーム依存パッケージは追加していません。
