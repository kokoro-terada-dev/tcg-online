# 条件評価器：独立した実行基盤

## 対応範囲

DSLの条件だけを評価する基盤です。発動、支払い、移動、解決、UIへの接続はまだ行いません。
前段の `schemaOnly` な定義を「すべて実行対応済み」へ変更しません。
条件が成立しても、タイミング・対象・コスト・回数・カード状態の検証を省略してはいけません。

| ファイル | 役割 |
| --- | --- |
| `server/src/test/effects/facts.ts` | サーバー側の情報スナップショットから値を安全に参照 |
| `server/src/test/effects/predicates.ts` | 型付き実行Registry、三値論理、比較、実行量上限 |
| `server/test/predicates.cjs` | 欠損値、参照、演算、型不整合、拡張、上限のテスト |

現行のMatch/CardMaster/ProgressionからFactsを組み立てる接続コードは未実装です。
実行済みの盤面修正を含む現在値が必要です。今後、基本パワーをそのまま現在パワーとみなして接続してはいけません。
既存の通常対戦・一人回し・テスト対戦の動作は変更しません。

## 入力の契約

1. JSONを既存のDSL検証器で検証する。
2. 信頼するサーバーが、その時点の確定済み情報からFactsを作る。
3. evaluateConditionで条件だけを評価する。
4. 成立・不成立・不明をそのまま後続の発動判定に渡す。

クライアントの申告値やprojectMatch後の公開ViewをFactsの情報源にはしません。
表示用に情報が伏せられていることと、サーバーも情報を知らないことを混同しないためです。
Facts自体はサーバー内部用で、相手へそのまま配信してはいけません。

SELF/OPPONENTは効果の実行者を基準にサーバーが割り当てます。画面の上下やhost/guestの見た目では決めません。
SOURCEは効果元、TARGETはSelectorが現在判定している候補です。イベント元はEVENT_SOURCEとEVENTに分離します。
GAMEには進行基盤の通算ターン・手番・フェーズを渡す予定です。
VARIABLEは先行ステップで確定した結果を、known/unknown付きで保持します。今回は比較可能なスカラーとスカラー配列のみ評価します。

## 不明な値の扱い

- 参照先の未提供、フィールドの未登録・null、不正な数値や型はunknownです。
- 0、false、空配列は正しい値であり、欠損ではありません。
- 明示的なliteral nullは既知のnullです。
- 参照コンテキスト自体を明示的にnullと渡した場合は「そのカードが存在しないことが確認済み」を表します。
- コンテキストを省略した場合は「情報が未提供」であり、存在しないと決めつけません。
- EXISTSは既知のnullなら不成立、既知の0/false/空配列なら成立、情報未提供ならunknownです。
- マスターのpower=nullなどは既知のパワー0ではなくunknownです。

unknownをfalseに潰してからNOTを取ることは禁止です。そうすると欠損データを理由に効果が成立してしまいます。

| 演算 | 結果 |
| --- | --- |
| NOT unknown | unknown |
| true AND unknown | unknown |
| false AND unknown | false |
| false OR unknown | unknown |
| true OR unknown | true |

AND/ORで別の条件だけから結果が確定する場合は、その確定値を返します。
後続処理はunknownを成立と扱いません。unknownの理由は診断用コードであり、公開チャットへ直接送信しません。

## 比較と型

EQ/NEQはスカラーの厳密比較です。配列同士の等価比較は未対応としてunknownにします。特徴や色の条件にはCONTAINS/INを使用します。
GT/GTE/LT/LTEは数値のみです。数値文字列を暗黙変換しません。
IN/NOT_INは配列内の厳密一致、CONTAINSはスカラー配列内の厳密一致または文字列の部分一致です。
配列要素や文字列の表記は正規化しません。`B・W` と `B･W` は別物です。
参照する枚数やコストは0以上の整数、パワーは負の整数にも対応します。ターン番号・プレイヤー番号も検証します。
不正な値からtrueを作らずunknownにします。未登録の命令・比較演算・参照フィールドは明確なエラーです。

## 拡張と上限

PredicateMapの型と構造パーサーに加え、PredicateRuntimeRegistryにも実行ハンドラーを登録します。
構造検証が通っただけの新命令を自動的にtrueにしません。実行登録がなければエラーにします。
型付き登録はkindと結果型を確認します。数値などを真偽値として返すハンドラーは拒否します。
実行開始後の登録変更、既存kindの上書きは禁止です。

1回の条件評価は最大512ステップ・深さ24です。子条件だけでなく値参照もステップを消費します。
拡張ハンドラーが無限に再帰したり参照を繰り返したりしても上限で停止します。
これは解決全体の予算とは別です。Selectorの候補全体には共有4,096ステップの累積予算を追加しました。解決全体の累積予算は今後追加します。
配列はコピーして返し、元のサーバー状態をfreeze・変更しません。参照は自身のデータプロパティだけを読み、getterや継承プロパティを評価しません。

## 次の接続条件

対象候補の生成、選択者別の情報公開、インスタンス世代の検証、複数コストの計画・原子的な確定、共通移動器、ResolutionEngineが必要です。
対象選択の独立基盤は [Selectorの設計](selector-runtime.md) として追加しました。既存Matchからの変換や実際のカード移動はまだありません。
それらを組み合わせて2端末でターン・攻撃・カウンター・ダメージを確認するまでは、自動対戦が完成したとは扱いません。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/selectors.cjs test/predicates.cjs test/progression.cjs test/effects-schema.cjs test/effects-types.cjs test/test-game.cjs test/test-lobby.cjs
```
