import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { analyzeV3DraftBlockers } from "./analyze-v3-draft-blockers.js";
import { normalizeV3Gap } from "./analyze-v3-draft-gaps.js";
import { resolveReviewOutput } from "./review-v3-catalog.js";
import { contracts, diagnoseV3DraftSpan, dissectV3DraftSpan } from "./v3-draft-diagnostics.js";
import { fieldDonCondition } from "./v3-draft-structure.js";

const require = createRequire(import.meta.url);
const { profiles } = require("../docs/card-effect-supported-operations.json");
const { supportsV3RuntimeProfile } = require("../server/dist/test/effects/v3/compiler.js");
const categories = ["generator", "runtime", "composition", "interpretation", "data", "unknown"];
const catalog = fileURLToPath(new URL("../server/data/effects-v3-reviewed", import.meta.url));
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const assert = (value, message) => { if (!value) throw Error(message); };
const byFrequency = (a, b) => b.cards - a.cards || b.spans - a.spans || lexical(a.id, b.id);
const spanKey = ({ cardId, variantSha256, field, start, end }) => JSON.stringify([cardId, variantSha256, field, start, end]);

function buckets(rows, keys, { examples = false } = {}) {
  const result = new Map();
  for (const row of rows) for (const id of new Set(keys(row))) {
    if (!result.has(id)) result.set(id, { spans: 0, cardRecords: 0, cards: new Set(), sample: row, features: new Set() });
    const bucket = result.get(id);
    if (row.variantSha256) bucket.spans++; else bucket.cardRecords++;
    bucket.cards.add(row.cardId);
    if (examples) for (const finding of row.findings) bucket.features.add(finding.feature);
  }
  return [...result].map(([id, b]) => ({ id, spans: b.spans, cardRecords: b.cardRecords, cards: b.cards.size,
    ...(examples ? { features: [...b.features].sort(lexical), example: {
      cardId: b.sample.cardId, variantSha256: b.sample.variantSha256, field: b.sample.field, start: b.sample.start, end: b.sample.end,
      raw: b.sample.raw, findings: b.sample.findings
    } } : {}) })).sort(byFrequency);
}

function reviewRows(input, trace, spans) {
  if (input === undefined) return [];
  assert(input?.version === "v3-draft-detail-reviews.1" && input.sourceCsvSha256 === trace.sourceCsvSha256 &&
    input.registryHash === trace.registryHash && Array.isArray(input.entries), "Review must be pinned to the source and Registry");
  const byKey = new Map(spans.map(row => [spanKey(row), row])), seen = new Set();
  return input.entries.map(review => {
    const key = spanKey(review), row = byKey.get(key), { category, feature, raw, reviewer, evidence } = review;
    assert(row && row.raw === raw && categories.includes(category) && typeof feature === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(feature) &&
      typeof reviewer === "string" && reviewer.trim().length > 0 && reviewer.length <= 120 &&
      typeof evidence === "string" && evidence.trim().length > 0 && evidence.length <= 2000, "Invalid or stale human review");
    const identity = JSON.stringify([key, feature, reviewer]);
    assert(!seen.has(identity), "Duplicate human review");
    seen.add(identity);
    return { cardId: row.cardId, variantSha256: row.variantSha256, field: row.field, start: row.start, end: row.end, raw,
      category, feature, reviewer, evidence, classificationMode: "human-reviewed" };
  });
}

export function analyzeV3DraftDetails(bytes, previous, current, reviews) {
  const fieldDonSupported = current.version === "v3-draft-generator.7";
  const schemaVersion = fieldDonSupported ? "3.0.0-subset.47" : "3.0.0-subset.46", profile = profiles[schemaVersion];
  assert((fieldDonSupported || current.version === "v3-draft-generator.6") && current.registryHash === profile.registryHash &&
    supportsV3RuntimeProfile({ definition: { schemaVersion }, compilerVersion: profile.compilerVersion, registryHash: profile.registryHash }),
  "Detailed rules require a pinned PR25 or PR27 trace and executable profile");
  const operations = new Set(Object.entries(profile.registries).flatMap(([category, entries]) => entries.map(entry => `${category}:${entry.split("@")[0]}`)));
  for (const [, required] of Object.values(contracts)) for (const operation of required)
    assert(operations.has(operation), `Diagnostic contract requires existing operation: ${operation}`);
  const { findings, summary: baseline } = analyzeV3DraftBlockers(bytes, previous, current);
  const inherited = new Map(), data = new Map();
  for (const row of findings) {
    const key = row.variantSha256 ? spanKey(row) : row.cardId, index = row.variantSha256 ? inherited : data;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ category: row.category, feature: row.feature, evidence: row.evidence, classificationMode: "automatic" });
  }
  const spans = [], cardRecords = [...data].map(([cardId, findings]) => ({ cardId, findings }));
  for (const card of current.cards) for (const variant of card.variants) for (const span of variant.spans) {
    if (span.status === "recognized") continue;
    const row = { cardId: card.cardId, status: card.status, cardType: variant.cardType, variantSha256: variant.pairSha256, displayIds: variant.displayIds,
      field: span.field, start: span.start, end: span.end, raw: span.text };
    const structure = dissectV3DraftSpan(row.raw, row.start);
    spans.push({ ...row, structure, findings: diagnoseV3DraftSpan({ ...row, structure, reason: span.reason, inherited: inherited.get(spanKey(row)), fieldDonSupported }) });
  }
  assert(spans.length === baseline.spans, "Detailed span count must match the validated trace");
  const human = reviewRows(reviews, current, spans);
  const rows = [...spans, ...cardRecords], grouped = buckets(rows, row => row.findings.map(f => f.category));
  const byFeature = buckets(rows, row => row.findings.map(f => f.feature));
  const structural = buckets(spans, row => {
    const signature = Object.entries(row.structure.signals).filter(([, signals]) => signals.length)
      .map(([dimension, signals]) => `${dimension}=${signals.map(s => s.id).join(",")}`);
    return [`${row.field}:${signature.join(";") || normalizeV3Gap(row.raw)}`];
  }, { examples: true });
  const wording = buckets(spans, row => [`${row.field}:${normalizeV3Gap(row.raw)}`], { examples: true });
  const allFeatures = (prefix, key = prefix) => buckets(rows, row => row.findings.some(f => f.feature.startsWith(prefix)) ? [key] : [])[0] ??
    { id: key, spans: 0, cardRecords: 0, cards: 0 };
  const recommend = (id, features, next) => {
    const counts = buckets(rows, row => row.findings.some(f => features.includes(f.feature)) ? [id] : [])[0];
    return counts ? { ...counts, next } : null;
  };
  const recommendations = [
    fieldDonSupported
      ? recommend("field-don-context-unconfirmed", ["field-don-context-unconfirmed"], "Review the remaining timing, compound conditions and action text; do not add a duplicate count primitive.")
      : recommend("field-don-comparison", ["field-don-comparison"], "Add public field DON count reads and compare them without exposing DON instances."),
    recommend("trigger-self-play", ["trigger-self-play", "trigger-self-play-condition", "trigger-self-play-payment"], "First support an explicit condition without costs; review paid triggers separately."),
    recommend("multiple-timings", ["multiple-timings", "simple-multiple-timings"], "Start with proven independent timing tags and review shared use limits separately."),
    recommend("ownership-and-chooser", ["unscoped-owner-destination", "explicit-chooser-complex"], "Review the official owner, controller and chooser per pattern before changing target generation."),
    recommend("other-trigger-body", ["other-trigger-body"], "Separate life-trigger calls to ON_PLAY, ON_KO and COUNTER; verify each timing before implementation."),
    recommend("self-only-continuous-stat", ["self-only-continuous-stat"], "Add source-object targeting without matching same-name copies."),
    recommend("counter-hand-payment", ["counter-hand-payment"], "Validate extra activation payment and printed cost atomically at COUNTER activation."),
    recommend("uninspected-deck-discard", ["uninspected-deck-discard"], "Use blind deck-top-to-trash work without opening a LOOK_TOP scope."),
    recommend("effect-deck-shuffle", ["effect-deck-shuffle"], "Use server-owned randomness and invalidate old revealed deck references."),
    recommend("compose-existing-costs", ["exact-don-payment-draw", "rest-source-select-rest"], "Extend the generator only; retain activation cost and subsequent action ordering."),
    recommend("rush-character-reminder", ["rush-character-reminder"], "Recognize the standalone printed keyword plus exact reminder in the generator."),
    recommend("battle-end-trigger", ["battle-end-trigger"], "Add a battle-end occurrence before modifier expiry, not another duration."),
    recommend("damage-replacement", ["damage-replacement"], "Verify replacement before damage processing, including lethal and repeated damage.")
  ].filter(Boolean).sort(byFrequency);
  const counts = categories.map(id => grouped.find(row => row.id === id) ?? { id, spans: 0, cardRecords: 0, cards: 0 });
  const byCard = new Map();
  for (const row of rows) {
    if (!byCard.has(row.cardId)) byCard.set(row.cardId, new Set());
    for (const f of row.findings) byCard.get(row.cardId).add(f.category);
  }
  const powerDash = cardRecords.filter(row => row.findings.some(f => f.feature === "printed-metadata" &&
    JSON.parse(f.evidence).some(issue => issue.field === "パワー" && issue.value === "-")));
  const summary = { version: "v3-draft-details.1", executable: false, sourceCsvSha256: current.sourceCsvSha256, schemaVersion,
    registryHash: current.registryHash, compilerVersion: profile.compilerVersion, cohort: baseline.cohort, spans: spans.length, cardRecords: cardRecords.length,
    categories: counts, features: byFeature, overlappingSpans: spans.filter(row => new Set(row.findings.map(f => f.category)).size > 1).length,
    multiCauseSpans: spans.filter(row => row.findings.length > 1).length, overlappingCards: [...byCard.values()].filter(x => x.size > 1).length,
    focus: [allFeatures("trigger-self-play"), allFeatures("multiple-timings"), allFeatures("simple-multiple-timings"),
      { id: "power-dash", spans: 0, cardRecords: powerDash.length, cards: powerDash.length }],
    humanReviews: human.length, humanReviewedCategories: buckets([...new Map(human.map(row => [spanKey(row) + row.category, row])).values()], row => [row.category]),
    groups: { structural: structural.length, wording: wording.length }, recommendations };
  const fieldDonCohort = fieldDonSupported ? compareFieldDonCohort(previous, current) : undefined;
  if (fieldDonCohort) summary.fieldDon = {
    cards: new Set(fieldDonCohort.map(row => row.cardId)).size, spans: fieldDonCohort.length,
    byCondition: buckets(fieldDonCohort, row => row.conditions.map(condition => condition.kind)),
    newlyRecognized: buckets(fieldDonCohort, row => row.pattern?.startsWith("pr27-field-don-") ? [row.pattern] : [])
  };
  return { summary, spans, cardRecords, humanReviews: human, structural, wording, ...(fieldDonCohort ? { fieldDonCohort } : {}) };
}

function compareFieldDonCohort(previous, current) {
  const latest = new Map(current.cards.flatMap(card => card.variants.flatMap(variant => variant.spans.map(span => [
    spanKey({ ...span, cardId: card.cardId, variantSha256: variant.pairSha256 }), { status: card.status, pattern: span.pattern }
  ]))));
  return previous.cards.flatMap(card => card.variants.flatMap(variant => variant.spans.flatMap(span => {
    if (span.status === "recognized") return [];
    const { signals } = dissectV3DraftSpan(span.text, span.start);
    const conditions = signals.conditions.filter(condition => condition.id === "field-don-comparison").map(condition => {
      const predicate = fieldDonCondition(condition.text.replace(/(?:の)?場合$/u, ""));
      return { ...condition, kind: !predicate ? "compound-or-unconfirmed" : typeof predicate.right === "object" ? "relative" : "fixed", predicate };
    });
    if (!conditions.length) return [];
    const row = { cardId: card.cardId, variantSha256: variant.pairSha256, displayIds: variant.displayIds,
      field: span.field, start: span.start, end: span.end, raw: span.text, conditions };
    return [{ ...row, ...latest.get(spanKey(row)) }];
  })));
}

export function renderV3TopGroups({ structural, wording }) {
  const cell = value => value.replaceAll("|", "\\|").replace(/[\r\n]/gu, " ");
  const render = groups => groups.slice(0, 30).map((group, index) => {
    const e = group.example, evidence = e.findings.map(row => `${row.category}/${row.feature}: ${row.evidence}`).join(" / ");
    return `| ${index + 1} | ${group.cards} | ${group.spans} | ${cell(group.id)} | ${e.cardId}: ${cell(e.raw)} | ${cell(evidence)} |`;
  }).join("\n");
  const header = "| 順位 | 影響番号 | 箇所 | グループ | 代表原文 | 代表例の自動分類・根拠 |\n| ---: | ---: | ---: | --- | --- | --- |";
  return `# 未解釈グループ上位30\n\n各行の分類は代表例の自動判定。グループ全体の意味一致や人手確認は保証しない。\n\n## 構造別\n\n${header}\n${render(structural)}\n\n## 正規化表現別\n\n${header}\n${render(wording)}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, before, current, output, flag, review] = process.argv.slice(2);
    assert(process.argv.length === 6 || process.argv.length === 8 && flag === "--reviews",
      "Usage: analyze-v3-draft-details.js <source.csv> <previous-trace> <current-trace> <new-report-dir> [--reviews file.json]");
    const json = file => {
      assert(fs.statSync(file).size <= 64 * 1024 * 1024, "Analysis input exceeds 64 MiB");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    };
    assert(fs.statSync(source).size <= 25 * 1024 * 1024, "Source CSV exceeds 25 MiB");
    const report = analyzeV3DraftDetails(fs.readFileSync(source), json(before), json(current), review ? json(review) : undefined);
    const directory = resolveReviewOutput(catalog, output);
    fs.mkdirSync(directory);
    const write = (file, value) => fs.writeFileSync(path.join(directory, file), value, { flag: "wx" });
    write("summary.json", JSON.stringify(report.summary, null, 2) + "\n");
    write("details.json", JSON.stringify(report) + "\n");
    write("top-30.md", renderV3TopGroups(report));
    const { categories, spans, cardRecords, focus, overlappingSpans, multiCauseSpans, overlappingCards, humanReviews, groups, fieldDon } = report.summary;
    console.log(JSON.stringify({ categories, spans, cardRecords, focus, overlappingSpans, multiCauseSpans, overlappingCards, humanReviews, groups, fieldDon }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
