import { test } from "node:test";
import assert from "node:assert/strict";
import { csv } from "./audit-effect-cards.js";
import { compareV3DraftRuns, normalizeV3Gap } from "./analyze-v3-draft-gaps.js";

const hash = "0".repeat(64);
const span = (text, status = "unknown") => ({ field: "text", start: 0, end: text.length, text, status });
const row = (cardId, text, status, spans) => ({
  cardId, status, compiler: status === "complete" ? "passed" : "not_checked",
  unresolved: spans.filter(row => row.status !== "recognized").length,
  variants: [{ pairSha256: cardId, text, triggerText: "", spans }]
});
const trace = (version, cards) => ({ version: `v3-draft-generator.${version}`, sourceCsvSha256: hash, registryHash: hash,
  totals: { sourceCards: cards.length, unresolvedSpans: cards.reduce((sum, row) => sum + row.unresolved, 0) }, cards });
const coverage = labels => csv([["card_id", "classification", "source_csv_sha256", "approval", "compiler"],
  ...labels.map(([id, label, approved]) => [id, label, hash, approved ? '{"sourceConfirmed":true}' : "null", "not_checked"])]);

test("grouping merges cosmetic and numeric differences while preserving the raw example and counting cards once", () => {
  const text = "〖登場時〗カード２枚を引く。", other = "【登場時】カード3枚を引く。";
  const before = trace(1, [row("A", text, "unconvertible", [span(text)]), row("B", other, "unconvertible", [span(other)]),
    row("APPROVED", "-", "complete", [])]);
  const after = trace(2, [row("A", text, "complete", [{ ...span(text, "recognized"), pattern: "synthetic" }]), before.cards[1], before.cards[2]]);
  const oldCoverage = coverage([["A", "未判定"], ["B", "未判定"], ["APPROVED", "承認済み", true]]);
  const newCoverage = coverage([["A", "対応候補"], ["B", "未判定"], ["APPROVED", "承認済み", true]]);
  const diff = compareV3DraftRuns(before, after, oldCoverage, newCoverage);
  assert.equal(normalizeV3Gap(text), normalizeV3Gap(other));
  assert.equal(diff.groups.length, 1);
  const group = diff.groups[0];
  assert.deepEqual([group.spans, group.cards, group.resolvedCards, group.expressibility, group.example],
    [2, 2, 1, "context_required", text]);
  assert.deepEqual(diff.improvements, [{ pattern: "synthetic", spans: 1, cards: 1, newCompleteCards: 1 }]);
  assert.deepEqual(diff.approvedOverlap.map(row => [row.cardId, row.reason]), [["APPROVED", "existing-approval-precedes-candidate"]]);
  assert.deepEqual(diff.cardChanges.map(row => row.cardId), ["A"]);
  assert.throws(() => compareV3DraftRuns(before, { ...after, sourceCsvSha256: "other" }, oldCoverage, newCoverage), /same CSV/);
  const stale = structuredClone(after);
  stale.cards[0].variants[0].text = "modified";
  assert.throws(() => compareV3DraftRuns(before, stale, oldCoverage, newCoverage), /Raw variant changed/);
});

test("PR21 comparisons flag a dropped complete card or changed definition hash against either baseline", () => {
  const a = { ...row("A", "-", "complete", []), definitionHash: "a" };
  const b = { ...row("B", "-", "complete", []), definitionHash: "b" };
  const oldCoverage = coverage([["A", "対応候補"], ["B", "対応候補"]]);
  const newCoverage = coverage([["A", "対応候補"], ["B", "未判定"]]);
  const after = trace(3, [{ ...a, definitionHash: "changed" }, { ...b, status: "unassessed", compiler: "not_checked", reasons: ["withheld"] }]);
  for (const version of [1, 2]) {
    const diff = compareV3DraftRuns(trace(version, [a, b]), after, oldCoverage, newCoverage);
    assert.deepEqual(diff.regressions, ["A", "B"]);
    assert.equal(diff.cardChanges[0].definitionHashBefore, "a");
    assert.deepEqual(diff.cardChanges[1].reasonsAfter, ["withheld"]);
  }
});
