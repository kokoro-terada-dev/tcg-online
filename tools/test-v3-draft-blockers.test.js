import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { generateV3Drafts } from "./generate-v3-drafts.js";
import { analyzeV3DraftBlockers } from "./analyze-v3-draft-blockers.js";
import { v3DraftRegistry } from "./analyze-v3-coverage.js";

const { SOURCE_COLUMNS } = createRequire(import.meta.url)("../server/dist/test/effects/v3/cardData.js");
const row = (id, text, fields = {}) => ({
  "表示ID": id, "カード番号": id, "カード名": id, "種類": "CHARACTER", "コスト": "1", "パワー": "2000",
  "カウンター": "-", "ライフ": "-", "色": "赤", "属性": "斬", "特徴": "合成", "テキスト": text, "トリガー": "", ...fields
});
function fixture(...rows) {
  const bytes = Buffer.from([SOURCE_COLUMNS, ...rows.map(r => SOURCE_COLUMNS.map(field => r[field] ?? ""))]
    .map(values => values.map(v => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n"));
  const generated = generateV3Drafts(ledgerFromCsv(bytes)).trace;
  const current = { ...generated, version: "v3-draft-generator.4", registryHash: v3DraftRegistry("v3-draft-generator.4") };
  const previous = { ...structuredClone(current), version: "v3-draft-generator.3",
    registryHash: "731fa079caef72803c33c5221aa0d423c61196b3752102408985cd6c2510e852" };
  return { bytes, previous, current, generated };
}

test("counts only audited mechanics, keeps unknown compounds and distinguishes cards from spans and prints", () => {
  const a = row("SYN-A", "【登場時】自分の手札1枚を捨てることができる：ドン!!デッキからドン!!2枚までを、アクティブで追加する。\n【アタック時】相手のキャラ1枚までを、このターン中、コスト-2。",
    { "トリガー": "【トリガー】自分のライフが2枚以下の場合、このカードを登場させる。" });
  const b = row("SYN-B", "【登場時】コスト4以下のキャラ1枚までを、持ち主の手札に戻す。\n【登場時】カード1枚を引く。その後、未解釈処理。");
  const { bytes, previous, current, generated } = fixture(a, { ...a, "表示ID": "SYN-A_p1" }, b);
  const { summary, findings } = analyzeV3DraftBlockers(bytes, previous, current);
  assert.equal(summary.executable, false);
  assert.equal(summary.spans, 5);
  assert.equal(summary.cardOverlap, 2);
  assert.equal(summary.featureOverlap, 2);
  assert.deepEqual(summary.categories.map(r => [r.id, r.spans, r.cardRecords, r.cards]), [
    ["generator", 1, 0, 1], ["runtime", 2, 0, 1], ["interpretation", 1, 0, 1], ["data", 0, 0, 0], ["unknown", 1, 0, 1]
  ]);
  assert.deepEqual(findings.map(r => r.feature).sort(), [
    "compound-unreviewed", "explicit-target-or-stat", "optional-add-don", "trigger-self-play", "unscoped-owner-destination"
  ]);
  const recent = analyzeV3DraftBlockers(bytes, current, generated);
  assert.equal(recent.findings.find(r => r.feature === "optional-add-don").category, "unknown");
});

test("records printed dash by display ID and separates record blockers from raw occurrences", () => {
  const a = row("SYN-A", "【登場時】カード1枚を引き、自分の手札1枚を捨てる。", { "パワー": "-" });
  const { bytes, previous, current } = fixture(a, { ...a, "表示ID": "SYN-A_p1" });
  const old = previous.cards[0];
  old.status = "unconvertible";
  old.variants[0].spans[0].status = "unknown";
  old.recognized = 0;
  old.unresolved = 1;
  previous.totals.counts.unconvertible = 1;
  previous.totals.counts.unassessed = 0;
  previous.totals.unresolvedSpans = 1;
  const { summary } = analyzeV3DraftBlockers(bytes, previous, current);
  assert.equal(summary.spans, 0);
  assert.equal(summary.categories.find(r => r.id === "data").cardRecords, 1);
  assert.deepEqual(summary.newlyUnassessed, [{
    cardId: "SYN-A", before: "unconvertible", reasons: ["printed-metadata-unconfirmed"], recognizedBefore: 0, recognizedAfter: 1,
    printedIssues: [{ displayId: "SYN-A", field: "パワー", value: "-" }, { displayId: "SYN-A_p1", field: "パワー", value: "-" }]
  }]);
});

test("rejects incomplete or mismatched analysis input instead of quietly undercounting", () => {
  const { bytes, previous, current } = fixture(row("SYN-A", "【登場時】未解釈処理。"));
  assert.throws(() => analyzeV3DraftBlockers(bytes, previous, { ...current, registryHash: "new" }), /pinned CSV and Registry/);
  assert.throws(() => analyzeV3DraftBlockers(bytes, previous, { ...current, cards: [] }), /pinned CSV and Registry/);
  const changed = structuredClone(current);
  changed.cards[0].variants[0].spans[0].start++;
  assert.throws(() => analyzeV3DraftBlockers(bytes, previous, changed), /offsets or raw text/);
});
