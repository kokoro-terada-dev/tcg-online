import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { auditCards, normalizeComparison } from "./audit-effect-cards.js";
import { parseCsv } from "./build-card-master.js";
const { SOURCE_COLUMNS, validateReviewBundle, requireExecutableV3Card } = createRequire(import.meta.url)("../server/dist/test/effects/v3/cardData.js");
function input(patches) {
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  return [SOURCE_COLUMNS, ...patches.map(patch => SOURCE_COLUMNS.map(field => ({ "表示ID": "T-001", "カード番号": "T-001", "カード名": "試験", "種類": "CHARACTER", "テキスト": "【登場時】カード1枚を引く。", ...patch })[field] ?? ""))].map(row => row.map(quote).join(",")).join("\r\n");
}
test("CSV preserves quoted originals on demand without changing legacy trimming", () => {
  assert.equal(parseCsv('a\r\n"  x,\n""y""  "', { trim: false })[1][0], '  x,\n"y"  ');
  assert.equal(parseCsv('a\r\n"  x  "')[1][0], 'x');
  assert.throws(() => auditCards(input([{}]).slice(0, -1)));
});
test("variant differences never pick a canonical first row and normalization never approves effects", () => {
  const result = auditCards(input([{}, { "表示ID": "T-001_p1", "テキスト": "別の処理" }]));
  assert.equal(result.bundle.variants.length, 2); assert.equal(result.summary.uniqueCards, 1);
  assert.equal(Object.hasOwn(result.bundle.cards[0].consensus, "テキスト"), false);
  assert.equal(result.differences[0].normalizedValueCount, 2); assert.equal(result.summary.approved, 0);
  assert.deepEqual(result.bundle.cards[0].effects, []); assert.throws(() => requireExecutableV3Card(result.bundle.cards[0]));
});
test("comparison-only differences preserve both originals and remain unreviewed", () => {
  const a = "【ドン‼×1】\r\n\r\n処理  ", b = "【ドン!!×1】\n処理";
  assert.equal(normalizeComparison(a), normalizeComparison(b));
  const result = auditCards(input([{ "テキスト": a }, { "表示ID": "T-001_p1", "テキスト": b }]));
  assert.equal(result.bundle.variants[0].raw["テキスト"], a);
  assert.equal(result.differences[0].classification, "normalization-only-needs-review");
  assert.equal(result.bundle.cards[0].reviewStatus, "needs_review");
});
test("unknown types, duplicate display IDs and invalid numbers are quarantined without guessing repairs", () => {
  const result = auditCards(input([{}, { "種類": "キャラクタークター", "コスト": "?" }]));
  assert.equal(result.summary.anomalyRows, 1); assert.equal(result.bundle.cards[0].reviewStatus, "unsupported");
  assert.equal(result.bundle.variants[1].raw["種類"], "キャラクタークター");
  assert.equal(result.anomalies.length, 3);
});
test("missing columns and malformed rows fail instead of emitting incomplete definitions", () => {
  assert.throws(() => auditCards("カード番号,種類\nT-001,CHARACTER"));
  assert.throws(() => auditCards(input([{}]) + ',"extra"'));
});
test("review loader rejects approved flags, executable nodes, unsafe fields and unlinked variants", () => {
  const valid = auditCards(input([{}])).bundle;
  assert.equal(Object.isFrozen(valid.cards[0]), true);
  for (const mutate of [v => v.cards[0].reviewStatus = "approved", v => v.cards[0].effects.push({ type: "DRAW" }), v => v.cards[0].recordNumbers = [999], v => v.cards[0].consensus.extra = "bad", v => v.variants[0].cardId = "OTHER", v => v.cards[0].script = "anything"]) {
    const copy = structuredClone(valid); mutate(copy); assert.throws(() => validateReviewBundle(copy));
  }
  const example = { schemaVersion: "3.0-draft", cardId: "EXAMPLE-NOT-REAL", effects: [] };
  assert.throws(() => validateReviewBundle(example));
});
