# v3 段階1〜6の到達点

更新: 2026-10-29

## 結論

限定実カード14種類・50枚の緑キッドプリセットで、準備から勝敗まで進める隔離モードを実装しました。
ホスト先攻・ゲスト先攻の両経路はSocket.IOの2クライアントで確認済みです。
同一Wi-Fi向けの明示的なLAN起動もあります。実機iPhoneの表示・操作、公開環境への導入は未確認です。
全カード対応、汎用の裁定完備、本番運用の完成を意味しません。

## 段階と根拠

以下は既存の確認記録と対応コードの整理です。今回、全テストを再実行したという意味ではありません。
コードは`server/src/test/effects/v3/`、テストは`server/test/`にあります。

| 段階 | 到達点 | 主な実装 | 確認根拠 |
| --- | --- | --- | --- |
| 1 | 同一試合の連続解決、手番、個体・ターン単位の使用回数、要求の再送制御 | `matchCoordinator.ts`、`sessionProtocol.ts` | `v3-match-coordinator.cjs`、`v3-session-server.cjs` |
| 2 | 手札から登場、支払い、条件付き対象、サーチ、一時公開、並べ替え、選択待ちからの再開 | `fixtureCoordinator.ts`、Compiler/Registry、選択処理 | `v3-selection-compiler.cjs`、`v3-resolution.cjs`、`v3-fixture-coordinator.cjs` |
| 3 | パワー/コスト修正、4種のキーワード、ターン/バトル終了期限、世代変更時の失効 | `statEffects.ts`、`keywordEffects.ts`、`matchCoordinator.ts` | `v3-keywords.cjs`、`v3-match-coordinator.cjs` |
| 4 | 登場時・アタック時・相手アタック時・限定KO時の誘発、発生群の順序、中断・再開 | 誘発キュー、`fixtureCoordinator.ts`、`matchCoordinator.ts` | `v3-attack-effects.cjs`、`v3-ko-effects.cjs`、`v3-reviewed-entry.cjs` |
| 5 | 攻撃、効果、ブロック、手札/限定イベントカウンター、ダメージ、限定ライフトリガー、終了、勝敗 | `matchCoordinator.ts`、カウンター/トリガー処理 | `v3-counter-events.cjs`、`v3-match-coordinator.cjs`、`v3-session-server.cjs` |
| 6 | 独立承認された実カード、合法枚数プリセット、先後・マリガン・ライフ・初回DON、両者の勝敗・ルーム復帰 | `reviewedCatalog.ts`、`reviewedDeck.ts`、`reviewedSetup.ts`、`localServer.ts`、`src/testMatch/` | `v3-reviewed-catalog.cjs`、`v3-reviewed-setup.cjs`、`v3-reviewed-server.cjs` |

JSON追加だけで扱えるのは、現在のRegistryで正確に表現でき、原資料と定義が独立承認されたカードです。
新しい命令や条件にはRegistry/Compiler等の追加が必要です。未知の本文を推測変換したり、未対応能力を削って参加させたりしません。

## 今回補った確認

`v3-reviewed-entry.cjs`で、実際の承認済みプリセットのカード個体を用いた6ケースを追加しました。
盤面配置はテスト専用で、ルームから任意の初期盤面を注入する機能ではありません。

- OP01-033、OP01-048の対象選択とREST。既にレストならアクティブへ反転しません。
- OP01-054のレスト中・コスト範囲内だけのKOと、付与DONのREST DONへの返却。
- 各カードで対象0枚の場合に相手盤面を変更しないこと。
- 相手による選択回答の拒否、相手へ選択tokenを渡さないこと、同一work再送の二重適用防止。

## 明示的な制限

- 実カードモードはサーバー指定の`kid-basic`のみ。任意の保存デッキや未承認カードは使用できません。
- 実カードプリセットにはイベント/ライフトリガーがありません。その経路は限定された合成ケースでの確認です。
- 条件付き誘発の一部、トリガー自身の登場、複雑な追加コスト、汎用置換・耐性・継続効果等は未対応です。未対応を無視して進めません。
- DB保存・切断後の対戦復元・公開サービス運用は段階8です。サーバー再起動で部屋は失われます。
- 実機iPhoneの入力、重なり、画面サイズ差、Wi-Fi環境差は利用者による確認が残ります。ビルド成功を実機確認の代わりにしません。
- 通常オンライン対戦・一人回しへ、このv3ルール処理は適用していません。

## 試す場所

PC内の2ブラウザー: `npm run dev:effects-v3`

同じ信頼できるWi-Fiの2端末: `npm run dev:effects-v3:lan`

具体的な操作・LANの公開範囲は[限定実カードの手順](effects-v3-reviewed-cards.md)を参照してください。
次は実機で発見した不具合を優先し、カード追加や段階7への拡張とは分けて扱います。
