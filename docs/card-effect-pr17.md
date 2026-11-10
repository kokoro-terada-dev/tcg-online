# PR17: 承認カタログの分割とカード単位のレビュー

## 既存承認と配備の契約

- 配備側は `server/data/effects-v3-reviewed/catalog-root.json` を起点に読む。従来の `manifest.json` は変更せず、既存14枚を含む固定の最初のシャードとして参照する。PR17で新たに承認した実カードはない。
- ルートは旧manifestと追加シャードのパス、件数、SHA-256を持つ。シャードはファイル名順でハッシュ・読み込み順を固定する。JSONハッシュはパース後の `JSON.stringify`（UTF-8）で計算するため、インデントやファイルの改行コードには依存しない。承認の `definitionHash`、`sourceHash`、`compilerVersion`、`registryHash` は従来の照合方法のまま。
- ルート・シャード・定義・出典が欠落、重複、不整合の場合は全体を拒否する。ルートがない場合に旧形式へ自動フォールバックしない。索引外のファイルを列挙してロードせず、パストラバーサル、シンボリックリンク、ジャンクションを拒否する。
- 追加シャード最大128、1シャード最大128カード、カタログ全体最大8192カード・8192出典ファイル、1ファイル256 KiB、読み込み128 MiB。出典の照合はカード番号の索引を使う。サーバーは既定カタログを初回に検証してキャッシュし、対戦へは両デッキに入る定義だけを渡す。索引を更新した場合は再起動して反映する。
- ルートはデプロイ時に管理者が選ぶ信頼済み構成であり、署名ではない。ファイルが正規のレビューを経たことはリポジトリの権限・レビューで担保する。通信経由でルートや承認を受け取らない。

## 個別レビュー手順

1. サーバーをビルドし、公式CSVから差分を出す。出力先は信頼ディレクトリの外にある新規ファイルとする。

   ```powershell
   npm --prefix server run build
   node tools/review-v3-catalog.js diff server/data/effects-v3-reviewed local-data/review-diff.json local-data/v3-review-ledger-pr00-20261029/source.csv
   ```

2. 差分をカード番号ごとに確認する。既存承認、変更項目、原文・トリガーの別版、表示ID、元CSVのSHA-256、CSVレコード番号を照合する。`quarantine`、未対応能力、UNKNOWN、裁定保留は承認しない。`missing_from_input` はCSVにないという報告であり、承認の取り消しではない。
3. 個別カードの定義・出典・レビューを用意する。新規シャードの形式は `{"version":"v3-reviewed-shard.1","rulesetVersion": "...","sources":[...],"cards":[...]}`。各 `cards` 項目は `file`、独立した承認 `approval`、`review` を持つ。既存の承認を使い回して定義を変えることはできない。承認済みの追加カードを更新する場合は定義版を変える。
4. 新規出典は `v3-reviewed-source.2` とし、`sourceCsvSha256` は原本CSVのバイトのSHA-256を使う。`cards` には印刷情報（既存の出典と同じ項目）と `variants: [{displayId, recordNumber, text, triggerText}]` を記録する。カード定義の `source.datasetSha256` はこのスナップショット自体のハッシュ。別版を統合せず、レビュー担当者がCSVとの対応を確認する。出典照合時は公式の欠落記号 `-` だけを空欄と同じ扱いにする。
5. `review` は `status: "verified"` と `coverage` を持つ。文節ごとに `field`（`text` / `triggerText`）、`start`・`end`（JavaScript文字列のUTF-16オフセット）、`references` を書く。例: `{"field":"text","start":0,"end":12,"references":["effect:main"]}`。各フィールドを隙間なく覆い、`effect:<id>`、`keyword:<type>`、`continuous:<id>`、`replacement:<id>` を実際の定義に結び付ける。原文と実装が意味的に等しいかは人が確認する。
6. レビュー済みファイルを新しいパスに置いて、索引案を出す。置換では旧シャードを残したまま `shards/old.json=shards/new.json` を指定する。無関係な承認を維持し、承認済みカードが消える提案は拒否する。

   ```powershell
   node tools/review-v3-catalog.js index server/data/effects-v3-reviewed local-data/catalog-root-proposal.json shards/batch-001.json
   ```

7. 提案のカード別差分と各承認・出典を確認し、管理者が別途ルートを反映する。ツールは承認を発行せず、配備側のファイルも既存出力も上書きしない。固定の旧14枚の再レビュー・失効や承認済みカードの撤回はこのワークフローの対象外。

## 検証と変更ファイル

- 関連16件成功。全回帰は一括953件成功（失敗・スキップ0）。フロント・サーバーのビルドは各1回成功。手元の公式CSVでは2,885番号を比較し、155番号を保留、差分レポートからの実行可能カードは0件。
- 集計: 8ファイル（新規5、既存3）、生成物を除き+509/-38行。Schema・Compiler・Registry・既存承認ファイルは変更していない。

| 区分 | 変更ファイル |
| --- | --- |
| 配備索引 | `server/data/effects-v3-reviewed/catalog-root.json` |
| 承認・対戦セットアップ | `server/src/test/effects/v3/reviewedCatalog.ts`、`reviewedCoverage.ts`、`reviewedSetup.ts` |
| 差分・索引案作成 | `tools/review-v3-catalog.js` |
| テスト | `server/test/v3-reviewed-shards.cjs` |
| 資料 | `docs/card-effect-implementation-roadmap.md`、`docs/card-effect-pr17.md` |
