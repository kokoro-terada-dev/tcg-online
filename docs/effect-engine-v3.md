# 汎用効果エンジン v3 導入記録

## 基準と今回の範囲

2026-10-28に渡されたeffect_engine_v3_codex_spec.mdを今後の基準とします。
添付のJSON例は3.0-draftの設計例であり、実行可能な効果や裁定済みfixtureではありません。
代表18件もNEEDS_MANUAL_RULE_REVIEWであり、正解の状態遷移として自動採用しません。
今回完了したのはPhase 1の既存調査・CSV監査・監査用型/Schemaです。
最終版CardDefinition、v3 DSL Compiler/Runtime、承認フロー、実カード効果の実行は未実装です。

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

Phase 2ではv3の厳密な型/Schema、Compilerと各Registry、版・原文ハッシュ・承認証跡付きCardDefinitionを整備します。
まず限定命令を明示的に実装し、それ以外はロード時にunsupportedとして拒否します。既存のkind形式は別版のまま維持します。
Phase 3で保存可能なResolutionFrameと選択待ち/復帰を接続します。Phase 4以降に置換・継続・バトル統合を進めます。
同時誘発の順序、複数置換の選択、勝敗チェックの位置、トリガー機会、KO誘発時点、継続効果の循環等は
RulesetPolicyとして根拠と確認状態を保持し、未確認の組合せでは停止する設計とします。今回は裁定を確定していません。

```powershell
npm --prefix server run build
node --test tools/audit-effect-cards.test.js tools/test-card-master.test.js
npm run build
```
