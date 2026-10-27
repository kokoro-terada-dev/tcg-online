# カードマスター管理手順（テスト対戦用の基盤）

## 今回できること・まだしないこと

- 従来のCSVと既存デッキJSONをそのまま利用できます。
- サーバーが名前・パワー・カウンター値・特徴などを参照できます。
- 効果の説明と発動タイミングを別CSVで登録できます。
- 効果の自動実行、コスト支払い、パワー合計、勝敗判定はまだ追加していません。
- 通常対戦・一人回しのソースは変更しません。生成JSONの既存項目は互換性を維持します。

## ファイルの役割

| 場所 | 役割 | Git管理 |
| --- | --- | --- |
| `local-data/card-master.csv` | 実際に変換するカード情報 | しない |
| `local-data/card-effects.csv` | 実際に変換する効果情報。今は見出しだけ | しない |
| `local-data/card-master-expanded.csv` | 既存全カードに新しい空列を追加した入力用コピー | しない |
| `local-data/card-master-template.csv` | 架空の3枚による記入例。実データではない | しない |
| `local-data/card-effects-template.csv` | 架空の効果による記入例。実データではない | しない |
| `public/card-master.json` | CSVから生成する配信用JSON | する |

ひな形のEXAMPLEから始まるIDは説明用です。実際のカード情報として登録しないでください。
JSONはWebに配信されるため、秘密情報・個人情報は入れないでください。

## 最初の入力：既存カードを消さずに始める

1. VS Codeで `C:\Users\kensh\workspace_server` を開きます。
2. 作成済みの `local-data/card-master-expanded.csv` をスプレッドシートへインポートします。
3. 既存のID、種類、数値、effectsは残したまま、右側の新しい列に必要な情報を入力します。まず数枚で構いません。
4. そのシートだけを「CSV（UTF-8、カンマ区切り）」でダウンロードします。XLSXやタブ区切りではありません。
5. ダウンロードしたファイル名を `card-master.csv` にし、`local-data` の同名ファイルへ配置します。元のCSVを残したい場合は事前に別名コピーしてください。
6. VS Codeのターミナルで、次のコマンドを実行します。

```powershell
cd C:\Users\kensh\workspace_server
npm run build:card-master
```

7. `OK: ... cards, ... effects` と表示されたら成功です。ERRORならJSONは更新されません。表示されたIDや列名を直して再実行してください。
8. JSON更新後はGitへコミット・pushし、配信サイトとテストサーバーを再デプロイします。利用者はデッキを保存し直す必要はありません。

拡張入力コピーを作り直すコマンドは `npm run build:card-master -- --prepare` です。
既存の `card-master-expanded.csv` は上書きしません。必要なら先にそのファイルを別名へ変更してください。
このコマンドは元CSVや配信用JSONを変更しません。

## カード情報の列

```csv
id,type,cost,power,counter,effects,name,colors,attributes,traits,life,effectIds
```

| 列 | 記入方法 |
| --- | --- |
| `id` | 必須。一意の画像・デッキのカードIDと完全一致。変更しない |
| `type` | leader / character / event / stage / don / unknown。空欄はunknown |
| `cost` | 0以上の整数。空欄またはNULLは不明 |
| `power` | 0以上の整数。空欄またはNULLは不明 |
| `counter` | 0以上の整数。カウンターなしを確認済みなら0。不明なら空欄 |
| `effects` | 旧仕様の目印。onPlay / onAttack / onKo。複数は `onPlay|onAttack` |
| `name` | 名前。空欄は不明 |
| `colors` | 色。複数は `red|green`。全カードで同じ表記に統一 |
| `attributes` | 属性。複数は半角の `|` で区切る |
| `traits` | 特徴。複数は半角の `|` で区切る。日本語も可 |
| `life` | リーダーの基本ライフ。空欄は不明 |
| `effectIds` | 通常は空欄でOK。効果CSVのcardIdから自動関連付けする |

カンマ入りの数字（5,000）、単位付き数字（5000パワー）、負数、小数は入力できません。
空欄と0は別物です。未登録のパワーを0として自動判定することはありません。
旧6列CSVも利用可能です。任意列を追加する場合は見出しを上記の綴りにしてください。
列が途中で足りない行、見出しの誤字、重複IDは変換エラーになります。

## 効果情報：カードとは別シートで管理

`local-data/card-effects.csv` を別シートとしてインポートして使います。

```csv
effectId,cardId,timing,displayText,implementation
```

| 列 | 記入方法 |
| --- | --- |
| `effectId` | 効果ごとの一意ID。例：カードID.onPlay1。同じカードでも効果ごとに別ID |
| `cardId` | カード情報に存在するID |
| `timing` | onPlay / onAttack / onKo / activateMain / main / counter / trigger / continuous |
| `displayText` | 人が読む説明。カンマ・改行も利用可。プログラムとして実行しない |
| `implementation` | 最初は必ず unsupported。manualも登録可能だが、手動専用UIはまだ未実装 |

効果シートだけをCSVとしてダウンロードし、`local-data/card-effects.csv` に配置して同じ変換コマンドを実行します。
別シートをまとめたXLSXをそのまま配置しないでください。
同じカードの複数効果は行を増やします。onPlay/onAttack/onKoは従来のeffectsにも自動反映します。
効果CSVがない場合・見出しだけの場合も基本情報の変換は可能です。
削除した効果IDをカードのeffectIdsに残すとエラーになります。

## 今後の効果処理の追加方針

今回は説明・タイミング・対応状況までを確定します。conditions / costs / targets / steps / duration / usageLimit は実行エンジンと一緒に次段階で定義します。
複雑なJSONを各セルへ手入力する方式にはしません。共通効果は列や別シートで入力し、特殊効果のみ効果IDに対応する専用コードで扱う方針です。
unsupportedな効果を自動実行済み扱いにしません。

## サーバーの安全対策

- マスターはテストサーバー起動時に1回読み込み、対戦ごとに変更不能な版を保持します。
- 標準の読込先はリポジトリの `public/card-master.json` です。必要時は `TEST_CARD_MASTER_PATH` で絶対パスを指定できます。
- ファイルなし・形式不正・未知スキーマでは警告を出し、情報を不明として既存の手動対戦だけ継続します。自動判定はまだ行いません。
- 非公開の手札・デッキ・ライフにはカード情報を添付しません。
- 名前やパワーは利用者の送信値ではなくサーバーのマスターから取得します。
- 現段階ではマスターを理由にデッキやカード移動を禁止しません。マスターの正確性を確認後、将来の自動処理時に必要情報を検証します。

## 開発者向け確認コマンド

```powershell
node --test tools/test-card-master.test.js
npm run build
cd server
npm run build
node --test test/test-lobby.cjs test/test-game.cjs
```
