import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { normalizeV3Gap } from "./analyze-v3-draft-gaps.js";
import { collectProbes, v3DraftRegistry } from "./analyze-v3-coverage.js";
import { csv } from "./audit-effect-cards.js";
import { resolveReviewOutput } from "./review-v3-catalog.js";
import { optionalDonBody } from "./v3-draft-structure.js";

const categories = ["generator", "runtime", "interpretation", "data", "unknown"];
const statuses = ["complete", "partial", "unconvertible", "unassessed"];
const fields = ["text", "triggerText"];
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const assert = (condition, message) => { if (!condition) throw Error(message); };
const catalog = fileURLToPath(new URL("../server/data/effects-v3-reviewed", import.meta.url));
const printedRequired = { CHARACTER: ["コスト", "パワー"], LEADER: ["パワー", "ライフ"], EVENT: ["コスト"], STAGE: ["コスト"] };

function indexTrace(trace, ledger, version) {
  assert(trace.version === `v3-draft-generator.${version}` && trace.sourceCsvSha256 === ledger.sourceSha256 &&
    trace.registryHash === v3DraftRegistry(trace.version) && trace.cards.length === ledger.cards.length &&
    trace.totals.sourceCards === ledger.cards.length && trace.totals.selectedCards === ledger.cards.length, "Expected a full pinned CSV and Registry trace");
  const index = new Map(trace.cards.map(card => [card.cardId, card]));
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  let unresolvedSpans = 0;
  for (const source of ledger.cards) {
    const card = index.get(source.cardId);
    assert(card && statuses.includes(card.status) && card.sourceCsvSha256 === ledger.sourceSha256 &&
      card.variants.length === source.variants.length, `Invalid trace card: ${source.cardId}`);
    counts[card.status]++;
    let recognized = 0, unresolved = 0;
    const byPair = new Map(card.variants.map(variant => [variant.pairSha256, variant]));
    for (const original of source.variants) {
      const v = byPair.get(original.pairSha256);
      assert(v && fields.every(field => v[field] === original[field]) &&
        isDeepStrictEqual(v.displayIds, original.displayIds) && isDeepStrictEqual(v.recordNumbers, original.recordNumbers),
      `Trace variant differs from CSV: ${card.cardId}`);
      const expected = fields.flatMap(field => v[field] === "-" ? [] :
        [...v[field].matchAll(/[^\r\n]+/gu)].filter(m => m[0].trim()).map(m => [field, m.index, m.index + m[0].length, m[0]]));
      assert(isDeepStrictEqual(expected, v.spans.map(s => [s.field, s.start, s.end, s.text])),
        `Trace offsets or raw text differ from CSV: ${card.cardId}`);
      for (const span of v.spans) {
        assert(["recognized", "unsupported", "unknown"].includes(span.status), "Invalid span status");
        if (span.status === "recognized") recognized++;
        else unresolved++;
      }
    }
    assert(card.recognized === recognized && card.unresolved === unresolved && (card.status !== "complete" || !unresolved),
      `Trace span counts differ: ${card.cardId}`);
    unresolvedSpans += unresolved;
  }
  assert(index.size === ledger.cards.length && isDeepStrictEqual(counts, trace.totals.counts) &&
    unresolvedSpans === trace.totals.unresolvedSpans, "Trace totals differ");
  return index;
}

const timings = "(?:登場時|アタック時|相手のアタック時|KO時|起動メイン|メイン|カウンター|トリガー)";
const parseTiming = new RegExp(`^(?:【(${timings})】|〖(${timings})〗)(.*)$`, "u");
const optionalDon = new RegExp(`(?:^|[、：:。】〗])${optionalDonBody}`, "u");
function spanFindings(variant, span, probes, optionalDonSupported) {
  const raw = span.text.trim(), timing = parseTiming.exec(raw), body = timing?.[3];
  const label = timing?.[1] ?? timing?.[2];
  const out = [];
  const add = (category, feature, evidence) => out.push({ category, feature, evidence });
  for (const probe of probes) {
    if (probe.field === span.field && span.text.includes(probe.quote)) add("runtime", probe.feature, probe.evidence);
  }
  if (span.field === "triggerText" && variant.cardType === "character" && label === "トリガー" &&
    /(?:の場合、|[：:])このカードを登場させる。$/u.test(body)) {
    add("runtime", "trigger-self-play", "Conditional or paid self-play is not admitted by PLAY_TRIGGER_SOURCE; prefix not classified");
  }
  if (optionalDonSupported ? optionalDon.test(raw) :
    /(?:^|[、：:。】〗])ドン[!！]{2}デッキからドン[!！]{2}(?:[1-9]|10)枚までを、?(?:アクティブ|レスト)で追加する。/u.test(raw)) {
    add(optionalDonSupported ? "unknown" : "runtime", "optional-add-don", optionalDonSupported
      ? "ADD_DON_UP_TO is supported; the full printed span is still unresolved"
      : "ADD_DON is fixed-count and fails on shortage; no DON-deck count ref or selectable DON-deck source");
  }
  if (/^(?:コスト|パワー)(?:0|[1-9][0-9]*)(?:以下|以上)のキャラ[1-5]枚までを、持ち主の(?:手札に戻す|デッキの下に置く)。$/u.test(body)) {
    add("interpretation", "unscoped-owner-destination", "Destination owner is explicit; source side and chooser must be verified independently");
  }
  if (!out.length && label && (span.field === "triggerText") === (label === "トリガー") && (
    (variant.cardType === "event" && label === "カウンター" &&
      /^自分のリーダー1枚までを、このバトル中、パワー\+[1-9][0-9]{0,4}。$/u.test(body)) ||
    /^(?:相手の元々のパワー(?:0|[1-9][0-9]{0,4})以下のキャラ[1-5]枚までを、KOする|相手のキャラ[1-5]枚までを、このターン中、コスト[+-][1-9][0-9]{0,4})。$/u.test(body)
  )) {
    add("generator", "explicit-target-or-stat", "Existing public SELECT, base.power, KO and MODIFY_STAT with TURN_END/BATTLE_END");
  }
  if (!out.length) {
    const composition = /かつ|その後、|^[・]|以下から.+選ぶ|リーダー(?:か|と)キャラ/u.test(raw);
    add("unknown", composition ? "compound-unreviewed" : "unclassified-expression",
      span.reason ?? "No audited interpretation of the full raw span");
  }
  return [...new Map(out.map(f => [f.feature, f])).values()];
}

function dataFindings(source, rows, draft) {
  const dataReasons = source.reasons.filter(reason => /^(?:raw-variant-difference:|source-audit:)|^(?:text-trigger-variant-conflict|invalid-card-type)$/u.test(reason));
  const values = printedIssues(rows);
  const findings = [];
  if (dataReasons.length) findings.push({ category: "data", feature: "source-record-conflict", evidence: dataReasons.join("; ") });
  if (values.length || draft.reasons.includes("printed-metadata-unconfirmed")) findings.push({
    category: "data", feature: "printed-metadata", evidence: JSON.stringify(values.length ? values : draft.reasons)
  });
  if (source.reasons.includes("trigger-clause-in-body-needs-review")) findings.push({
    category: "interpretation", feature: "trigger-in-body", evidence: "Review the printed text/trigger boundary without reassigning it"
  });
  return findings;
}

function printedIssues(rows) {
  return rows.flatMap(({ displayId, raw }) => {
    const columns = printedRequired[raw["種類"]] ?? [];
    return columns.filter(field => !/^\d+$/u.test(raw[field]) || !Number.isSafeInteger(Number(raw[field])))
      .map(field => ({ displayId, field, value: raw[field] }));
  });
}

function tally(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!map.has(id)) map.set(id, { spans: new Set(), records: new Set(), cards: new Set(), example: row });
    const bucket = map.get(id);
    (row.variantSha256 ? bucket.spans : bucket.records).add(row.location);
    bucket.cards.add(row.cardId);
  }
  return [...map].map(([id, { spans, records, cards, example }]) => ({
    id, spans: spans.size, cardRecords: records.size, cards: cards.size, example
  })).sort((a, b) => b.cards - a.cards || b.spans - a.spans || lexical(a.id, b.id));
}

export function analyzeV3DraftBlockers(bytes, previous, current) {
  const ledger = ledgerFromCsv(bytes);
  const prior = current.version === "v3-draft-generator.7" ? 6 : current.version === "v3-draft-generator.6" ? 5 : current.version === "v3-draft-generator.5" ? 4 : current.version === "v3-draft-generator.4" ? 3 : 2;
  const optionalDonSupported = prior >= 4;
  const before = indexTrace(previous, ledger, prior), after = indexTrace(current, ledger, prior + 1);
  const byCard = new Map();
  for (const row of ledger.rows) {
    if (!byCard.has(row.cardId)) byCard.set(row.cardId, []);
    byCard.get(row.cardId).push(row);
  }
  const findings = [], newlyUnassessed = [];
  let spans = 0;
  for (const source of ledger.cards) {
    const cardId = source.cardId, draft = after.get(cardId), old = before.get(cardId), rows = byCard.get(cardId);
    if (draft.status === "complete") continue;
    if (draft.status === "unassessed" && old.status !== "unassessed") newlyUnassessed.push({
      cardId, before: old.status, reasons: draft.reasons, recognizedBefore: old.recognized, recognizedAfter: draft.recognized, printedIssues: printedIssues(rows)
    });
    const cardFields = { cardId, status: draft.status, variantSha256: "", field: "", start: "", end: "", raw: "", location: cardId };
    const cardFindings = dataFindings(source, rows, draft);
    if (!cardFindings.length && !draft.unresolved) cardFindings.push({ category: "unknown", feature: "unclassified-card", evidence: draft.reasons.join("; ") });
    for (const finding of cardFindings) findings.push({ ...cardFields, ...finding });
    for (const variant of draft.variants) {
      const probes = collectProbes([variant]);
      for (const span of variant.spans) {
        if (span.status === "recognized") continue;
        spans++;
        const { field, start, end, text: raw } = span, variantSha256 = variant.pairSha256;
        const at = { cardId, status: draft.status, variantSha256, field, start, end, raw, location: `${cardId}:${variantSha256}:${field}:${start}:${end}` };
        for (const finding of spanFindings(variant, span, probes, optionalDonSupported)) findings.push({ ...at, ...finding });
      }
    }
  }
  assert(spans === current.totals.unresolvedSpans, "An unresolved span is outside the report cohort");
  const byCategory = tally(findings, row => row.category);
  const byCardFindings = new Map();
  for (const row of findings) {
    if (!byCardFindings.has(row.cardId)) byCardFindings.set(row.cardId, { categories: new Set(), features: new Set() });
    byCardFindings.get(row.cardId).categories.add(row.category);
    byCardFindings.get(row.cardId).features.add(row.feature);
  }
  const soloFeatures = new Map();
  for (const { features } of byCardFindings.values()) if (features.size === 1) {
    const [id] = features;
    soloFeatures.set(id, (soloFeatures.get(id) ?? 0) + 1);
  }
  const summary = { version: "v3-draft-blockers.1", executable: false, sourceCsvSha256: ledger.sourceSha256, registryHash: current.registryHash,
    cohort: Object.fromEntries(statuses.slice(1).map(status => [status, current.totals.counts[status]])), spans,
    categories: categories.map(id => byCategory.find(row => row.id === id) ?? { id, spans: 0, cardRecords: 0, cards: 0 }),
    features: tally(findings, row => row.feature).map(row => ({ ...row, onlyFindingCards: soloFeatures.get(row.id) ?? 0 })), newlyUnassessed,
    cardOverlap: [...byCardFindings.values()].filter(row => row.categories.size > 1).length,
    featureOverlap: [...byCardFindings.values()].filter(row => row.features.size > 1).length,
    groups: tally(findings.filter(row => row.variantSha256), row => `${row.field}:${normalizeV3Gap(row.raw)}`) };
  return { summary, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [source, before, current, output] = process.argv.slice(2);
    assert(process.argv.length === 6, "Usage: analyze-v3-draft-blockers.js <source.csv> <baseline-generation.json> <current-generation.json> <new-report-dir>");
    const trace = file => {
      assert(fs.statSync(file).size <= 64 * 1024 * 1024, "Trace exceeds 64 MiB");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    };
    const { summary, findings } = analyzeV3DraftBlockers(fs.readFileSync(source), trace(before), trace(current));
    const directory = resolveReviewOutput(catalog, output);
    fs.mkdirSync(directory);
    const write = (file, data) => fs.writeFileSync(path.join(directory, file), data, { flag: "wx" });
    write("summary.json", JSON.stringify(summary, null, 2) + "\n");
    const columns = ["cardId", "status", "variantSha256", "field", "start", "end", "category", "feature", "evidence", "raw"];
    write("findings.csv", csv([columns, ...findings.map(row => columns.map(key => row[key]))]));
    const counts = rows => rows.map(({ example, ...row }) => row);
    console.log(JSON.stringify({ cohort: summary.cohort, spans: summary.spans, cardOverlap: summary.cardOverlap, featureOverlap: summary.featureOverlap,
      categories: counts(summary.categories), features: counts(summary.features), newlyUnassessed: summary.newlyUnassessed.map(row => row.cardId) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
