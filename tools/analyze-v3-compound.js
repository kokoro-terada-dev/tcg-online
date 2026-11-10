import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v3DraftRegistry } from "./analyze-v3-coverage.js";
import { resolveReviewOutput } from "./review-v3-catalog.js";

const assert = (ok, message) => { if (!ok) throw Error(message); };
const key = ({ cardId, variantSha256, field, start, end }) => JSON.stringify([cardId, variantSha256, field, start, end]);
const count = rows => ({ cards: new Set(rows.map(row => row.cardId)).size, spans: rows.length });
const changes = value => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(changes);
  return value.ref === "BOTH.lifeCount" || value.owner === "CARD_OWNER" || value.type === "CARDS" &&
    (value.owner === "EITHER" || value.controller === "EITHER" || Array.isArray(value.zone) || value.onInsufficient === "skip") ||
    Object.values(value).some(changes);
};
const featureNames = row => new Set(row?.findings.map(f => f.feature) ?? []);
const groups = {
  timings: (row, ids) => row.structure.multipleTimings || ids.has("multiple-timings") || ids.has("simple-multiple-timings"),
  ownership: (_, ids) => ids.has("unscoped-owner-destination") || ids.has("explicit-chooser-complex"),
  lifeSelfPlay: (_, ids) => [...ids].some(id => id.startsWith("trigger-self-play")),
  conditions: row => row.structure.signals.conditions.length > 0,
  sequence: row => row.structure.signals.order.length > 0,
  payment: row => row.structure.signals.costs.length > 0,
  existingComposition: (row, _, historical) => [...row.findings, ...(historical?.findings ?? [])].some(f => f.category === "composition" || f.category === "generator")
};
function deferred(row, ids, pattern) {
  if (pattern) return "recognized; full card status is tracked separately";
  if (ids.has("multiple-timings") && /ターン[1１]回/u.test(row.raw)) return "shared usage limit needs a single effect identity across timing entries";
  if ([...ids].some(id => id.startsWith("trigger-self-play"))) return "remaining life cost, leader-color condition, or preceding operation is not covered by the admitted trigger program";
  if (ids.has("explicit-chooser-complex") || ids.has("unscoped-owner-destination")) return "destination, chooser, or surrounding operations cannot be generated without dropping text";
  return "no complete grammar for this span; preserve the source and diagnose the remaining conditions, costs or actions before extending";
}

export function analyzeV3Compound(pr26, pr28, before, after) {
  const digest = before.sourceCsvSha256;
  for (const [data, version] of [[before, 8], [after, 9]]) {
    assert(data.version === `v3-draft-generator.${version}` && data.executable === false && data.sourceCsvSha256 === digest &&
      data.registryHash === v3DraftRegistry(data.version), "Expected full pinned generation traces");
    assert(data.cards.length === data.totals.sourceCards, "Partial generation trace");
  }
  for (const [report, version] of [[pr26, 6], [pr28, 8]])
    assert(report.summary.sourceCsvSha256 === digest && report.summary.registryHash === v3DraftRegistry(`v3-draft-generator.${version}`), "Mismatched audit report");
  const history = new Map(pr26.spans.map(row => [key(row), row])), old = new Map(before.cards.map(c => [c.cardId, c]));
  const next = new Map(after.cards.map(c => [c.cardId, c]));
  assert(old.size === next.size && [...old.keys()].every(id => next.has(id)), "Card corpus mismatch");
  const unchanged = before.cards.filter(c => c.status === "complete");
  assert(unchanged.every(c => next.get(c.cardId).status === "complete" && next.get(c.cardId).definitionHash === c.definitionHash), "Complete definition regression");
  const rows = pr28.spans.map(row => {
    const historical = history.get(key(row)), ids = new Set([...featureNames(row), ...featureNames(historical)]);
    const current = next.get(row.cardId), variant = current.variants.find(v => v.pairSha256 === row.variantSha256);
    const span = variant?.spans.find(s => s.field === row.field && s.start === row.start && s.end === row.end);
    assert(span?.text === row.raw && old.get(row.cardId).status !== "complete", "Source span mismatch");
    const matched = span.status === "recognized";
    const program = span.effects ?? [span.effect].filter(Boolean);
    const called = program.flatMap(effect => effect.actions.filter(action => action.type === "CALL_EFFECT_BODY").map(action => action.effectId));
    const referenced = called.length ? variant.spans.flatMap(s => s.effects ?? [s.effect].filter(Boolean)).filter(e => called.includes(e.id)) : [];
    const needsExtension = changes([...program, ...referenced]) || matched && ["pr29-life-activation-cost", "pr29-life-sequence"].includes(span.pattern);
    return { cardId: row.cardId, variantSha256: row.variantSha256, displayIds: row.displayIds, field: row.field, start: row.start, end: row.end, raw: row.raw,
      groups: Object.keys(groups).filter(group => groups[group](row, ids, historical)), path: matched ? needsExtension ? "B" : "A" : "C",
      pattern: matched ? span.pattern : null, before: row.status, after: current.status, previousFindings: [...ids], reason: deferred(row, ids, matched) };
  });
  const byGroup = Object.fromEntries(Object.keys(groups).map(group => {
    const items = rows.filter(row => row.groups.includes(group));
    return [group, { scope: count(items), recognized: count(items.filter(r => r.path !== "C")), held: count(items.filter(r => r.path === "C")) }];
  }));
  const patterns = [...new Set(rows.map(row => row.pattern).filter(Boolean))].sort();
  const summary = { executable: false, sourceCsvSha256: digest, completeHashesUnchanged: unchanged.length,
    inputCards: before.cards.length - unchanged.length, ...count(rows), byGroup,
    paths: Object.fromEntries(["A", "B", "C"].map(path => [path, count(rows.filter(row => row.path === path))])),
    patterns: Object.fromEntries(patterns.map(pattern => [pattern, count(rows.filter(row => row.pattern === pattern))])) };
  const noSpanCards = before.cards.filter(card => card.status !== "complete" && card.unresolved === 0)
    .map(card => ({ cardId: card.cardId, priorReasons: card.reasons, after: next.get(card.cardId).status, reasons: next.get(card.cardId).reasons }));
  return { summary, rows, noSpanCards };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    assert(args.length === 5, "Usage: analyze-v3-compound.js <pr26-details> <pr28-details> <pr28-trace> <pr29-trace> <new-report-dir>");
    const read = file => {
      assert(fs.statSync(file).size <= 64 * 1024 * 1024, "Analysis input exceeds 64 MiB");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    };
    const report = analyzeV3Compound(...args.slice(0, 4).map(read));
    const catalog = fileURLToPath(new URL("../server/data/effects-v3-reviewed", import.meta.url));
    const directory = resolveReviewOutput(catalog, args[4]);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "analysis.json"), JSON.stringify(report) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report.summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
