# Selector：候補生成と選択セッションの独立基盤

## 今回の範囲

対象候補の生成、選択者向けView、回答検証を追加します。
既存対戦、Socket.IO、盤面UI、CSV・カードマスター形式は変更しません。
候補を選んでもカード移動・支払い・効果解決は実行しません。既存DSLのschemaOnly状態も変更しません。

| ファイル | 役割 |
| --- | --- |
| `effects/selectionTypes.ts` | サーバー内部カード、スナップショット、選択View、回答・結果の型 |
| `effects/selectors.ts` | 型付き実行Registry、候補生成、候補・枚数・世代の検証 |
| `effects/selectionSession.ts` | 一時トークン、選択者別View、回答の再検証、完了・キャンセル |
| `test/selectors.cjs` | 所有者・選択者・非公開性・回答・世代・各選択方式・予算のテスト |

## 情報源と参照

サーバーの確定済み状態からSelectionSnapshotを作る前提です。Matchからの変換・実際の世代更新は未実装です。
カードにはinstanceId、generation、owner、controller、zone、cardId、faceUp、現在値を含むFactsを渡します。
印刷されたcardIdだけで対象を識別しません。同名カード・同一カードIDが複数あってもinstanceIdで区別します。
選択者、対象所有者、対象コントローラーは別々に判定します。SELF/OPPONENTは効果のactor基準です。
TARGETのid/zoneは実体から供給し、Facts内の同名値では上書きしません。その他の参照は既存の条件評価器を使用します。
候補条件と除外条件を合わせて評価し、必要情報がunknownなら選択準備をunknownとして止めます。
情報不足のカードを黙って候補から外すことはしません。

## 選択方式

| モード | 動作 |
| --- | --- |
| SELECT | 最小～最大枚数を選択。回答の順番は移動順序の指定として扱わない |
| BLIND_SELECT | 内容を隠し、並びも無作為化した一時トークンから選択 |
| ORDER | 候補全体の順序を指定。現在はmin=max=候補数を要求 |
| RANDOM | サーバーの暗号学的乱数で重複なく選択。現在はmin=maxの確定枚数だけ対応 |
| ALL | 全候補を選択。候補数が指定上限を超える場合は切り捨てず拒否 |
| CHOOSE_ONE相当 | DSLのchoiceを使用。1個の選択肢トークンを回答し、内部のoptionIdへ変換 |

RANDOM/ALLはクライアント回答や候補Viewを作らず、resolveAutomaticで解決します。
候補0枚でmin=0なら空集合を選択可能です。minに足りない場合はinsufficient-candidatesで止めます。
この枚数方針は現在のAPI契約です。効果の「可能な限り行う」や支払い可否と同一視せず、今後のResolution/Cost層で定義に応じた解決を設計します。
可変枚数のランダム選択、部分集合を選んでから順序指定する複合選択は、前段のchoiceなどとの組み合わせを今後設計します。

## 公開範囲と漏えい対策

候補生成結果やSelectionSessionそのものはサーバー内部用です。
クライアントへ送れるのはviewFor(viewer)の返却値だけで、選択者以外にはnullを返します。
Sessionはprivateフィールドで対応表を保持し、JSON.stringifyも明示的に拒否します。

- 回答は推測しにくい一時UUIDトークンのみ。実体ID・世代・非公開のカード情報を回答の根拠にしない。
- Viewには候補のtokenと、公開権限がある場合のcardIdだけを含む。能力・パワー・内部Factsは含まない。
- 自分の手札は内容確認可能。相手の手札・裏向きライフ・デッキは標準では確認できない。
- その他の表向きカードは標準の可視性に従う。ただしデッキはfaceUp指定だけでは公開しない。
- SELECT/ORDERで隠れたカードを見せるには、サーバー側で対象instanceId/generationを限定したrevealToChooserが必要。
- BLIND_SELECTは自分の手札を含め全候補のcardIdを隠す。各セッションで新しいトークンと無作為な並びを生成する。
- フィルターで候補から外れた非公開カードも「調べたカード」として管理する。0枚に絞られた結果も保護対象。
- 組み込みSelectorでは、非公開情報の条件判定より先に権限確認を行う。候補不足・情報欠損などの結果から件数が漏れるのを防ぐ。
- 条件付きのBLIND_SELECTはallowFilteredBlindSelectionをサーバーが明示的に許可した場合だけ対応。カードの効果・公開範囲を確認せず付けない。

revealToChooserやallowFilteredBlindSelectionをクライアントの申告から作ってはいけません。
拡張Selectorの作者も、評価エラーや候補数が非公開情報を漏らさないよう、実行前に公開権限を検証する責任を持ちます。
低レベルのprepareSelectorやSelectionErrorの詳細は内部診断用で、そのまま相手向けメッセージへ転送しません。
公開・閲覧権限の期間、検索したカードを相手へ見せる手順、検索後のシャッフルは今回まだ実装しません。

## 回答の検証と再検証

actorはsocketから認証した席を使います。payloadに送られたactorを信用しません。
回答形式はmatchId/resolutionId/selectionId/revision/tokensの5項目だけです。
別の対戦・解決・選択・revision、他人の回答、他のセッションのトークン、実体IDの直接指定、重複・枚数違反を拒否します。

確定前に最新のサーバースナップショットから候補を再生成し、以下を照合します。

1. 対戦IDとrevision。
2. 選ばれたカードのinstanceIdとgeneration。
3. 現在の位置・所有者・コントローラー・カードID・表裏。
4. 現在の条件と除外条件。

カードが場を離れて戻った場合も、世代が変わっていれば以前の対象として扱いません。
途中でunknownになった場合は確定しません。失敗した回答はセッションを完了扱いにしません。
すべてを検証した後に、内部結果を返してセッションを閉じます。完了後やcancel後の再回答は拒否します。
結果のカード集合はサーバー内部用であり、公開用Viewではありません。
SELECT/BLIND_SELECTの結果順は元のサーバー候補順、ORDERだけは回答順を維持します。
この段階では結果の保持とカード移動を一体化していないため、まだ効果解決のトランザクションとして使いません。

## 上限・拡張

スナップショット内のカードは最大256、調べる候補・選択候補は各128、回答トークンは128までです。
既存の条件評価1回512ステップ・深さ24に加え、候補全体で4,096ステップの共有予算を設けます。構造上の走査も予算を消費します。
RANDOM/BLIND_SELECTはnode:cryptoのrandomInt/randomUUIDを使います。
候補の書き換え・合成・同一実体の重複や、未知のSelector実行命令も拒否します。

SelectorMapの型、構造パーサー、SelectorRuntimeRegistryの実行登録をそろえて拡張します。
現段階では拡張の結果もcards/choiceの標準計画へ変換する必要があります。新しい結果型や後続アクションの変数型は別途設計します。
登録済みハンドラーは検証時にsealし、途中で差し替えません。

## 接続前に残る作業

- 現行カードへのgeneration導入と、領域移動時の更新。
- Match/Progressionからの権威あるスナップショット・現在値の生成。
- セッションIDを進行gateと結び、公開する選択待ち状態と同じrevisionで確定する処理。
- 回答の再送ack、レート制限、切断・永続化・復元、サーバーIDの再利用防止。
- 支払い・移動・結果保持・gate再開の原子的な確定。
- 選択UIと2端末での確認。

現在のcancelはサーバー内部で未解決セッションを閉じるだけです。支払い後のキャンセルや返金を実装したものではありません。
今回も自動対戦には未接続です。次は複数コストの計画と二重支払い防止を進めます。

```powershell
cd C:\Users\kensh\workspace_server\server
npm run build
node --test test/selectors.cjs test/predicates.cjs test/progression.cjs test/effects-schema.cjs test/effects-types.cjs test/test-game.cjs test/test-lobby.cjs
```
