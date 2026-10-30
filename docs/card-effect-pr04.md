# PR04: MAIN発動元の汎用化

実装日: 2026-10-30。基準コミット: `d6df2d4`。
対象は隔離v3のみ。PR05のイベントMAINや実カードの追加承認は行いません。

## 発動元の識別

`V3SyntheticMatchCoordinator.mainEffectsFor(actor)`で自分の公開leader/character/stageを列挙します。
承認ブランド付き定義、カード種類、領域、所有者、操作者、表向き、両者への公開が一致する発動元だけが対象です。
同名/同番号の別個体や、同じeffectIdを持つ別カードは別項目です。

`V3SessionView.effects[]`には以下を含めます。

```ts
{
  sourceToken: string;
  source: { instanceId: string; generation: number };
  cardId: string;
  zone: "leader" | "character" | "stage";
  slot: number;
  effectId: string;
  label: string;
  enabled: boolean;
  used: number;
  limit: number | null;
}
```

tokenはサーバー署名鍵によるHMAC-SHA256です。
`v3-main-source.1`、matchId、actor、完全なV3MatchContext、個体ref、領域、effectId、定義hashに結び付けます。
同じ状態の再同期では同じtoken、成功したコマンドでrevisionが変わると新しいtokenです。
退場/再登場でgenerationが変わった場合、古いtokenを新しい個体へ読み替えません。
Socket発動入口用のtokenと、解決中のSOURCE ref/選択tokenは別です。

送信形式は以下です。

```ts
{ kind: "activate", matchId, requestId, context, sourceToken, effectId }
```

actorはSocketのルーム所属から確定します。カード番号、source ref、所有者等の追加フィールドは拒否します。
旧形式のeffectIdだけでリーダーへフォールバックする入口は残していません。
通信形式が変わるため、開発サーバーを再起動し、両クライアントを再読み込みしてください。

## サーバー

- localServerの`session.sources[actor]`固定を削除。sessionViewはmainEffectsForを使用します。
- 相手のtokenや、手札内の発動元は送信しません。列挙は純粋な読取で、支払い/回数消費/frame生成を行いません。
- `activateMain`は既存のrequest receipt/revision検査後、現在のtoken/effectIdの組を再列挙・検証します。
- MAIN、自分のターン、mainフェイズ、gate/バトル/誘発待ち、解決中の別効果、使用回数、現在の発動条件・支払い可否を確認します。
- 条件/コストは既存fixtureEnvironmentとDerivedCardFactsを使用。UNKNOWN/例外は発動許可にしません。
- 入口では支払わず、既存V3FixtureCoordinatorへSOURCE/effectIdを渡し、既存の支払い・中断・再開機構で処理します。
- 同じrequestId/同じ内容の再送はreceiptでno-op。内容を変えた同一ID、新規IDの古いrevision、古いtokenは拒否します。
- 内部`activate(source,effectId)`は既存fixture回帰のため維持。合成fixtureが不成立条件/コスト不足を機械内で検査する既存テストの結果は変更しません。Socketからはこの旧内部入口を呼びません。

`effectsFor`は従来の内部読取です。Socketの可否には全モードで厳格なpreflightを行うmainEffectsForを使用します。
発動条件/解決条件の配置、誘発条件の成立時点は変更していません。

## フロント

自分のleader/characterはカード操作ダイアログの「登録済み効果」から、その個体のMAIN効果だけを開きます。
stageは既存のカードタップ経路から同じダイアログへ進みます。
中央モーダルは既存のレスポンシブな「左カード・右ボタン」のスタイルを再利用します。
発動不可/使用済みはdisabled表示し、複数効果は別ボタン。発動時は該当sourceToken/effectIdを送信します。
revision更新時にMAINダイアログを閉じます。従来の処理パネルには全カードのMAINボタンを重複表示しません。
盤面のエリア配置、共有TestBoard、通常対戦・一人回しは変更していません。

## 代表fixture

実カードは追加承認せず、合成モードのcharacter/stageに`fieldDraw`を追加しました。
内容は「MAIN・個体ごとターン1回・自身をレストして1枚ドロー」。既存REST_SOURCEとDRAWのみを使用します。
`session-entry.7`のテスト専用定義/証拠であり、実カードの承認manifestとは別です。
合成モードで手札のcharacter/stageを通常登場させ、登場時処理を終えると検証できます。
イベントは従来のCOUNTERのままで、MAINには列挙しません。

## バージョンと承認

DSL・JSON Schema・Compiler・Registryは未変更です。

| Schema | Compiler | Registry hash | 命令数 |
| --- | --- | --- | --- |
| 3.0.0-subset.16 | v3-subset-compiler.16.3 | 44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763 | 38 |
| 3.0.0-subset.17 | v3-subset-compiler.17.1 | d18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9 | 41 |
| 3.0.0-subset.18 | v3-subset-compiler.18.1 | ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916 | 44 |

frameはv3-frame.9のまま。SOURCEの世代・効果hash・解決revision等のpinを維持します。
既存14枚の定義・出典・manifest・rulesetは未変更。KidリーダーMAINも新token入口から同じ解決機構を呼びます。

## 検証

- 新規21件: MAIN核14件、character/stageの両座席Socket4件、クライアントのtoken組検査1件、ダイアログ2件。
- 関連テスト230件成功、失敗0、skip0。Ajv 8を有効にして旧16/17/18のSchema/Registryも検査。
- leader/character/stage正常発動、同名別個体、複数effectId、所有者/操作者、相手ターン、バトル中、退場/再登場、古い世代、token/effectId改ざん、別試合、回数、コスト不足、FALSE/UNKNOWN条件、選択待機、再送/古いrevision/改変requestId、私的選択を検証。
- 既存14枚のカタログ・Kid効果・登場時効果・先後/マリガン・2クライアントの勝敗/同ルーム復帰等を回帰確認。
- サーバー・フロントbuild成功。フロントは既存500KiB超チャンク警告のみ。
- iPhone実機のタップ/表示試験、全カードの意味的検査、本番DB復旧は未実施です。

```powershell
npm --prefix server run build
node --test server/test/v3-main-sources.cjs server/test/v3-session-server.cjs server/test/v3-reviewed-server.cjs tools/test-v3-session-client.test.js tools/test-v3-main-dialog.test.js
npm run build
npm run dev:effects-v3
```

通常の確認URLは`http://127.0.0.1:5190/`。使用中ならViteログでポートを確認してください。

## 保留

イベントMAIN（PR05）、未対応DSL、条件付き誘発、継続/置換、新カード承認は未実施です。
回数制限は既存SOURCE_OBJECTのみ。カード名共有/対戦1回などは別段階です。
不明な裁定を推測して補わず、未対応能力を省略して実カード全体を承認しません。
