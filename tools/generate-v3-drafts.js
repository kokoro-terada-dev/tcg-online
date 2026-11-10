import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { analyzeV3Coverage, collectProbes, writeV3Coverage } from "./analyze-v3-coverage.js";
import { reviewedPrintedDifferences } from "./review-v3-catalog.js";
import { csv } from "./audit-effect-cards.js";

const require = createRequire(import.meta.url);
const { loadReviewedV3Catalog } = require("../server/dist/test/effects/v3/reviewedCatalog.js");
const { compileV3CardJson, supportsV3RuntimeProfile } = require("../server/dist/test/effects/v3/compiler.js");
const { registryHash } = require("../docs/card-effect-supported-operations.json");
const version = "v3-draft-generator.1", schemaVersion = "3.0.0-subset.44";
const keywords = new Map([
  ["ブロッカー", ["BLOCKER", "(相手のアタックの後、このカードをレストにし、アタックの対象をこのカードにできる)"]],
  ["速攻", ["RUSH", "(このカードは登場したターンにアタックできる)"]],
  ["速攻：キャラ", ["RUSH_CHARACTER"]],
  ["バニッシュ", ["BANISH", "(このカードがダメージを与えた場合、トリガーは発動せずそのカードはトラッシュに置かれる)"]],
  ["ダブルアタック", ["DOUBLE_ATTACK", "(このカードが与えるダメージは2になる)"]],
  ["ブロック不可", ["CANNOT_BE_BLOCKED", "(このカードはブロックされない)"]]
]);
const timings = new Map([
  ["登場時", ["ON_PLAY", "triggered", ["character", "stage"]]],
  ["アタック時", ["ON_ATTACK", "triggered", ["character", "leader"]]],
  ["相手のアタック時", ["ON_OPPONENT_ATTACK", "triggered", ["character", "leader"]]],
  ["KO時", ["ON_KO", "triggered", ["character"]]],
  ["メイン", ["MAIN", "activated", ["event"]]],
  ["起動メイン", ["MAIN", "activated", ["character", "leader", "stage"]]],
  ["カウンター", ["COUNTER", "activated", ["event"]]],
  ["トリガー", ["TRIGGER", "triggered", ["character", "event", "stage"]]]
]);
const absent = value => value === "-" || value === "";
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...new Set(values)].sort(lexical);
const always = () => ({ type: "all", conditions: [] });

function parseSpan(span, cardType, gaps) {
  const { field, start, end, text } = span;
  const tag = /^(?:【([^】]+)】|〖([^〗]+)〗)(.*)$/u.exec(text.trim());
  const keyword = keywords.get(tag?.[1] ?? tag?.[2]);
  const body = tag?.[3]?.trim();
  const sourceSpan = { start, end };
  if (field === "text" && keyword && (cardType === "character" || cardType === "leader" && !keyword[0].startsWith("RUSH")) &&
    (body === "" || keyword.slice(1).includes(body))) {
    return { ...span, status: "recognized", keyword: { type: keyword[0], sourceSpan } };
  }
  const timing = timings.get(tag?.[1] ?? tag?.[2]);
  const draw = /^カード([1-9]|[1-4][0-9]|50)枚を引く。$/u.exec(body ?? "");
  if (timing && draw && (field === "triggerText") === (timing[0] === "TRIGGER") && timing[2].includes(cardType)) {
    const [type, kind] = timing;
    return { ...span, status: "recognized", effect: {
      id: `${field === "text" ? "body" : "trigger"}-${start}`, kind, timing: { type }, sourceZones: [type === "TRIGGER" ? "life" : cardType === "event" ? "hand" : cardType],
      optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [],
      actions: [{ type: "DRAW", player: "SELF", count: Number(draw[1]), sourceSpan }]
    } };
  }
  const features = sorted(gaps.filter(gap => gap.field === field && text.includes(gap.quote)).map(gap => gap.feature));
  return { ...span, status: features.length ? "unsupported" : "unknown", features };
}

function analyzeVariant(variant, rows) {
  const selected = rows.filter(row => variant.recordNumbers.includes(row.recordNumber));
  const types = sorted(selected.map(row => row.raw["種類"]));
  const cardType = types.length === 1 ? types[0].toLowerCase() : null;
  const gaps = collectProbes([variant]);
  const spans = ["text", "triggerText"].flatMap(field => absent(variant[field]) ? [] :
    [...variant[field].matchAll(/[^\r\n]+/g)].filter(match => match[0].trim()).map(match =>
      parseSpan({ field, start: match.index, end: match.index + match[0].length, text: match[0] }, cardType, gaps)));
  return { ...variant, cardType, spans };
}

function definitionFor(card, variant, raw, sourceCsvSha256) {
  const cardType = variant.cardType, stats = {
    cost: raw["コスト"], power: raw["パワー"], counter: raw["カウンター"], life: raw["ライフ"]
  };
  const required = { leader: ["power", "life"], character: ["cost", "power"], stage: ["cost"], event: ["cost"] }[cardType];
  const possible = [...required, ...(cardType === "character" ? ["counter"] : [])];
  const baseStats = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key,
    absent(value) ? null : /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined]));
  const labels = value => absent(value) ? [] : value.split("/");
  const colors = labels(raw["色"]);
  if (!raw["カード名"].trim() || !colors.length || (cardType === "character" && stats.counter === "") ||
    required.some(key => baseStats[key] === null) ||
    Object.entries(baseStats).some(([key, value]) => value === undefined || value !== null && !possible.includes(key))) return null;
  return {
    schemaVersion, cardId: card.cardId, cardVersion: "draft.pr19.1", cardType, name: raw["カード名"], baseStats, colors,
    traits: labels(raw["特徴"]), attributes: labels(raw["属性"]), reviewStatus: "needs_review",
    keywords: variant.spans.flatMap(span => span.keyword ? [span.keyword] : []),
    effects: variant.spans.flatMap(span => span.effect ? [span.effect] : []),
    source: { text: absent(variant.text) ? "" : variant.text, triggerText: absent(variant.triggerText) ? "" : variant.triggerText,
      displayIds: sorted(variant.displayIds), datasetSha256: sourceCsvSha256 }
  };
}

function generateCard(card, rows, sourceCsvSha256) {
  const variants = card.variants.map(variant => analyzeVariant(variant, rows));
  const spans = variants.flatMap(variant => variant.spans);
  const recognized = spans.filter(span => span.status === "recognized").length;
  const unresolved = spans.length - recognized;
  const base = { cardId: card.cardId, sourceCsvSha256, names: sorted(rows.map(row => row.raw["カード名"])),
    displayIds: sorted(rows.map(row => row.displayId)), variants, recognized, unresolved, noEffect: false,
    status: "unassessed", compiler: "not_checked", reasons: card.reasons };
  const variant = variants[0];
  if (card.disposition === "quarantine" || variants.length !== 1) return base;
  if (!["leader", "character", "stage", "event"].includes(variant.cardType)) return { ...base, reasons: ["card-type-unmodeled"] };
  if (unresolved) return { ...base, status: recognized ? "partial" : "unconvertible", reasons: ["uninterpreted-source"] };
  const noEffect = absent(variant.text) && absent(variant.triggerText);
  if (!recognized && (!noEffect || variant.cardType !== "character")) return { ...base, reasons: ["effect-absence-unconfirmed"] };
  const definition = definitionFor(card, variant, rows[0].raw, sourceCsvSha256);
  if (!definition || rows.some(row => reviewedPrintedDifferences(row.raw, definition).length)) return { ...base, reasons: ["printed-metadata-unconfirmed"] };
  try {
    const plan = compileV3CardJson(JSON.stringify(definition));
    if (!supportsV3RuntimeProfile(plan)) return { ...base, compiler: "passed", reasons: ["runtime-profile-mismatch"] };
    return { ...base, status: "complete", noEffect, compiler: "passed", compilerVersion: plan.compilerVersion,
      registryHash: plan.registryHash, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, definition };
  } catch (error) {
    return { ...base, status: "unconvertible", compiler: "failed", reasons: [error.message.slice(0, 512)] };
  }
}

export function generateV3Drafts(ledger, cardIds = []) {
  const selected = new Set(cardIds), rows = new Map();
  for (const row of ledger.rows) {
    if (selected.size && !selected.has(row.cardId)) continue;
    if (!rows.has(row.cardId)) rows.set(row.cardId, []);
    rows.get(row.cardId).push(row);
  }
  if ([...selected].some(id => !rows.has(id))) throw Error("Requested card ID does not exist in this CSV");
  const counts = { complete: 0, partial: 0, unconvertible: 0, unassessed: 0 };
  const cards = ledger.cards.filter(card => rows.has(card.cardId)).map(card => generateCard(card, rows.get(card.cardId), ledger.sourceSha256))
    .sort((a, b) => lexical(a.cardId, b.cardId));
  const totals = { sourceCards: ledger.cards.length, selectedCards: cards.length, counts, noEffect: 0, compilerPassed: 0, compilerFailed: 0, unresolvedSpans: 0 };
  for (const card of cards) {
    counts[card.status]++;
    totals.noEffect += Number(card.noEffect);
    totals.compilerPassed += Number(card.compiler === "passed");
    totals.compilerFailed += Number(card.compiler === "failed");
    totals.unresolvedSpans += card.unresolved;
  }
  const candidates = { version: "v3-coverage-candidates.1", sourceCsvSha256: ledger.sourceSha256, registryHash,
    cards: cards.flatMap(card => card.variants.length !== 1 ? [] : [{ cardId: card.cardId, variantSha256: card.variants[0].pairSha256,
      generation: { version, status: card.status, noEffect: card.noEffect, recognized: card.recognized, unresolved: card.unresolved },
      ...(card.definition ? { definition: card.definition } : {}) }]) };
  return { candidates, trace: { version, executable: false, sourceCsvSha256: ledger.sourceSha256, registryHash, totals,
    cards: cards.map(({ definition: _draft, ...card }) => card) } };
}

function writeDraftResults(directory, { candidates, trace }) {
  const write = (name, data) => fs.writeFileSync(path.join(directory, name), data, { flag: "wx" });
  write("candidates.json", JSON.stringify(candidates, null, 2) + "\n");
  write("generation.json", JSON.stringify(trace, null, 2) + "\n");
  write("generation.csv", csv([["card_id", "generation", "no_effect", "compiler", "recognized_spans", "unresolved_spans", "definition_sha256", "reasons"],
    ...trace.cards.map(card => [card.cardId, card.status, card.noEffect, card.compiler, card.recognized, card.unresolved, card.definitionHash ?? "", JSON.stringify(card.reasons)])]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, source, output, ...flags] = process.argv.slice(2), cardIds = [];
    if (!root || !source || !output || flags.length % 2) throw Error("Usage: generate-v3-drafts.js <catalog-dir> <source.csv> <new-output-dir> [--ledger file.json] [--card ID]");
    let auditLedger;
    for (let i = 0; i < flags.length; i += 2) {
      if (flags[i] === "--card") cardIds.push(flags[i + 1]);
      else if (flags[i] === "--ledger" && auditLedger === undefined) {
        if (fs.statSync(flags[i + 1]).size > 64 * 1024 * 1024) throw Error("Input ledger exceeds 64 MiB");
        auditLedger = JSON.parse(fs.readFileSync(flags[i + 1], "utf8"));
      } else throw Error("Unknown or duplicate option");
    }
    if (fs.statSync(source).size > 25 * 1024 * 1024) throw Error("Input CSV exceeds 25 MiB");
    const bytes = fs.readFileSync(source), generated = generateV3Drafts(ledgerFromCsv(bytes), cardIds);
    const report = analyzeV3Coverage(loadReviewedV3Catalog(root), bytes, { auditLedger, candidates: generated.candidates });
    writeV3Coverage(root, output, report);
    writeDraftResults(output, generated);
    console.log(JSON.stringify({ ...generated.trace.totals, coverage: report.counts, gaps: report.gaps.slice(0, 10) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
