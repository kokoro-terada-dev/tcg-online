# PR02a・PR02b: メタデータと能力タグ条件

基準コミット: `af3711a`。今回の対象はPR02a/bのみ。PR03以降は未実装です。
新しい実カード承認、原資料の正規化、既存manifestの更新は行っていません。

## バージョンと承認

| 項目 | 既存profile | メタデータprofile |
| --- | --- | --- |
| schemaVersion | 3.0.0-subset.16 | 3.0.0-subset.17 |
| Compiler | v3-subset-compiler.16.3 | v3-subset-compiler.17.1 |
| Registry命令数 | 38 | 41 |
| Registry hash | `44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763` | `d18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9` |
| Schema | schemas/effect-v3-subset.schema.json | schemas/effect-v3-subset17.schema.json |
| 生成資料用Schema | docs/card-effect-json-schema.json | docs/card-effect-metadata.schema.json |

`compileV3CardJson`は入力schemaVersionでbuiltin profileを選びます。
互換性のため`COMPILER_VERSION`と引数なし`builtinV3Registries()`は旧16を維持します。
新profileの版は`METADATA_COMPILER_VERSION`、`compilerVersionForSchema(schemaVersion)`で取得します。
旧16で新Predicateを使うと未知命令として拒否します。未知のSchema版も拒否します。

既存14枚は旧profileのままロード・動作し、定義/出典/approval/manifestのhashは変更しません。
schemaVersionを17へ変更したカードが旧approvalを再利用することはできません。
新しいカードは新しい独立レビューと、そのplan/profileに一致する承認が必要です。
異なるprofileのカードを同じ解決環境へ渡す場合も、それぞれのブランド付き承認、builtin profile、同じrulesetを検証します。
任意のRegistry追加やschemaOnlyのカスタム命令を同時に解禁したわけではありません。
保存frameはv3-frame.9を維持し、planのdefinition/compiler/registry/rulesetに一致する場合だけ再開します。

## 1. CARD_NAME

```json
{"type":"CARD_NAME","subject":"CANDIDATE","basis":"PRINTED","op":"ne","value":"ナミ"}
```

| パラメータ | 必須/値 |
| --- | --- |
| subject | 必須、SOURCEまたはCANDIDATE |
| basis | 必須、PRINTEDまたはCURRENT |
| op | 必須、eqまたはne |
| value | 必須、空白だけでない文字列、最大300 UTF-16単位 |

一致はJavaScript文字列の完全一致です。NFC/NFKC、全半角、大小文字、空白、記号、D/Ｄを変換しません。
これは公式のカード名同一性/エラッタの裁定を確定する機能ではありません。
原資料間の表記差を自動同一視せず、使用するliteralは承認する原資料へ対応付けてください。
名前の部分一致・正規表現・任意別カードへの参照はありません。

## 2. CARD_METADATA

```json
{
  "type":"CARD_METADATA","subject":"CANDIDATE","basis":"PRINTED",
  "field":"traits","match":"ANY","comparison":"EXACT","values":["麦わらの一味"]
}
```

| パラメータ | 必須/値 |
| --- | --- |
| subject/basis | CARD_NAMEと同じ |
| field | 必須、traits/colors/attributes |
| match | 必須、ANY/ALL/NONE/EXACT |
| comparison | 必須、EXACT/CONTAINS |
| values | 必須、1〜32個の重複しないliteral。各最大300、空白だけは不可 |

ANYは問い合わせ値のどれか、ALLは全部、NONEはどれも存在しないことを判定します。
match:EXACTは**順序によらない集合全体一致**で、余分な要素があればfalseです。
単に「色が赤を含む」はANY:[赤]であり、EXACT:[赤]とは違います。
比較は全フィールドで無変換のliteralです。色名の英日変換や特徴の区切り文字分割も行いません。

CONTAINSは**traitsだけ**で、特徴の各要素内の`String.includes`です。
例えば特徴要素「B・Wエージェント」に問い合わせ「B・W」は一致し、「B･W」は一致しません。
配列を結合してから部分一致しません。CONTAINSとmatch:EXACTの組合せは意味を曖昧にしないため拒否します。
colors/attributesのCONTAINS、正規表現、空の問い合わせ集合も拒否します。

例:

```json
{"type":"CARD_METADATA","subject":"CANDIDATE","basis":"PRINTED","field":"traits","match":"ALL","comparison":"EXACT","values":["超新星","麦わらの一味"]}
```

```json
{"type":"CARD_METADATA","subject":"CANDIDATE","basis":"CURRENT","field":"colors","match":"EXACT","comparison":"EXACT","values":["赤","緑"]}
```

不一致はNONEまたは既存not、複合条件は既存all/any/notで表します。
承認された定義の空配列は明示された空集合として扱いますが、定義が欠けている場合を空集合にはしません。

## 3. HAS_ABILITY

```json
{"type":"HAS_ABILITY","subject":"CANDIDATE","basis":"PRINTED","ability":"TRIGGER"}
```

| パラメータ | 必須/値 |
| --- | --- |
| subject | 必須、SOURCE/CANDIDATE |
| basis | 必須、PRINTED/GRANTED/CURRENT |
| ability | 必須、以下の11タグ |

```text
BLOCKER RUSH RUSH_CHARACTER CANNOT_BE_BLOCKED
MAIN ON_PLAY ON_ATTACK ON_OPPONENT_ATTACK ON_KO COUNTER TRIGGER
```

- PRINTED: 4キーワードは承認定義のkeywords、残りはeffects[].timingに基づきます。
- GRANTED: 既存台帳で当該の場の個体/世代へ付与された4キーワードだけです。
- CURRENT: 元のタグと、現在の有効なキーワード付与を合わせます。

GRANTEDでTRIGGERやON_ATTACK等を指定するとCompilerが拒否します。その種類の付与は未実装です。
DOUBLE_ATTACK/BANISH等の未知タグもCompilerが拒否し、持たないカードとして通しません。
Runtimeでも不明な能力の照会はunknownで、notを付けてもtrueにはなりません。

TRIGGERは当該カード自身のTRIGGER定義を参照します。本文に「トリガーを持つカード」と書かれているだけではtrueにしません。
triggerTextとTRIGGERの1対1検証は従来どおりCompilerが実施します。
COUNTERはイベント等のCOUNTERタイミングのタグで、手札カードのカウンター値が1000/2000であるという意味ではありません。
これは「その能力を今発動できるか」の判定ではありません。ON_ATTACKタグの存在は成立条件を満たしている証明ではありません。

## 読み取りと秘匿

DerivedCardFactsへmetadata.printed/currentとabilities.PRINTED/GRANTED/CURRENTを追加しました。
既存PredicateもSelector.filtersもfixtureEnvironment.evaluateと同じReaderを通ります。

- カタログに数値/名前があっても、非公開相手手札・未閲覧デッキ・裏向きライフは読めません。
- 閲覧済みデッキだけはその権限を持つ本人が読めます。選択token/候補は相手へ送りません。
- 古いgeneration、内部resolving、承認定義のないmetadataはUNKNOWNです。旧masterの不完全な情報から能力を推定しません。
- PRINTEDは承認済み定義の値です。CURRENTは既知の変更だけを反映し、未知のmodifierIds/grantIdsがあればUNKNOWNです。
- このPRで名前/特徴/色/属性を書き換えるアクションは追加していないため、モデル化済みの盤面ではCURRENT metadataはPRINTEDと同じです。
- 既知のpower/cost修正やキーワード台帳は、それだけを理由にmetadataを不明にはしません。
- 不明な条件で選択候補をfalseとして黙って落とさず、解決は安全停止します。

all/any/notは従来の三値評価です。allで別の条件が確実にfalse、anyで別の条件が確実にtrueなら、その短絡結果は使えます。
これはUNKNOWNをfalseへ変換する処理ではありません。

CANDIDATEはselector.filters内だけ。SOURCEは現在の発生元のrefです。
ON_KO/TRIGGERのSOURCE metadata読み取りは、この段階では未解決の参照規則を推定しないため拒否します。
任意の自リーダーや別のカード集合へのQueryはPR03以降であり、このPRにはありません。

## 代表条件の検証

### OP01-016 ナミ

```json
{"type":"all","conditions":[
  {"type":"CARD_NAME","subject":"CANDIDATE","basis":"PRINTED","op":"ne","value":"ナミ"},
  {"type":"CARD_METADATA","subject":"CANDIDATE","basis":"PRINTED","field":"traits","match":"ANY","comparison":"EXACT","values":["麦わらの一味"]}
]}
```

LOOK_TOP→BOUND_CARDS.filtersで検証。名前ナミを除外、複数特徴から一致、候補0枚、両操作者、私的候補、古いrevision/他人回答/再送を確認します。
新旧profileの定義が同じrulesetに個別承認されている合成環境でも動作させます。
OP01-016の原資料登録/公式裁定確認/カード全体の独立承認は別で、今回は追加していません。

### OP16-080

自分の手札のCARDS.filtersでHAS_ABILITY/PRINTED/TRIGGERを使う部分だけです。
そのカードの継続cost+1、条件付き破棄cost、攻撃先変更は未実装のままです。
この条件を使った合成SELECT例はあっても、OP16-080の完成した効果JSONや承認ではありません。

## 検証方法

```powershell
npm --prefix server run build
node --test server/test/v3-metadata.cjs
node docs/validate-card-effect-json.cjs --examples docs/card-effect-json-examples.json
npm run build
```

Schemaも確認する場合は生成ガイドのAjv 8用NODE_PATHを設定し、上記チェッカーへ`--schema`を追加します。
チェッカーはカードのschemaVersionごとに16/17のSchemaとCompilerを使い、結果に各版とhashを出します。
新17のSchemaはCompilerのsubject文脈/参照/承認検査の代わりにはなりません。

### 今回の確認結果

- 新規metadata Compiler/Runtimeテスト17件: 全件成功。
- 既存PR00/01・Compiler・解決/支払い・14枚・キーワード等132件: 成功（新規と合わせ149件）。
- 既存reviewed-server 2件、life trigger 4件: ローカル通信可能な環境で成功。
- Ajv 8を有効にしたSchemaテスト2件: スキップなしで成功。新旧14サンプルを両Schema/Compilerで検査し、負例8種類も両方が拒否。
- ユニークなnode:testケース合計157件成功。SchemaテストはAjv 8がなければ明示skipであり、未実施を成功とは表示しません。
- サーバー/フロントbuild成功。フロントは従来の500KiB超チャンク警告のみ。
- 実機iPhone操作の確認、新カードの独立承認、全カードの意味的レビューは行っていません。

## 未対応・保留

PR03の集合/存在Query、PR04以降のUI発生元やイベントMAIN、条件付き誘発、継続、メタデータ変更、能力の削除/任意付与、攻撃先変更は未実装です。
未知タグ、元々/現在の複雑な規則、名前/表記の公式alias、版差異の採用、LKIの解禁を推測しません。
実カードの承認は既存14枚のままで、未対応能力を省いたOP01-016/OP16-080を追加しません。
通常対戦・一人回しのソース、保存デッキ、ルーム設定は変更していません。
