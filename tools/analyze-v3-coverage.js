import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { csv } from "./audit-effect-cards.js";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { compareReviewedV3Ledger, resolveReviewOutput, reviewedPrintedDifferences } from "./review-v3-catalog.js";

const require = createRequire(import.meta.url);
const { loadReviewedV3Catalog } = require("../server/dist/test/effects/v3/reviewedCatalog.js");
const { compileV3CardJson, supportsV3RuntimeProfile } = require("../server/dist/test/effects/v3/compiler.js");
const { dataArray, dataObject } = require("../server/dist/test/movement/state.js");
const inventory = require("../docs/card-effect-supported-operations.json");
const probeRegistry = "731fa079caef72803c33c5221aa0d423c61196b3752102408985cd6c2510e852";
const probesEnabled = inventory.registryHash === probeRegistry && supportsV3RuntimeProfile({
  definition: { schemaVersion: "3.0.0-subset.44" }, compilerVersion: inventory.compilerVersion, registryHash: probeRegistry
});
const probes = [
  { feature: "effect-deck-shuffle", label: "効果によるデッキのシャッフル",
    quotes: ["デッキをシャッフルする。", "デッキに戻しシャッフルする。"],
    evidence: "dsl.ts ActionMap / resolution.ts WORK: setup shuffling is not an effect action" },
  { feature: "battle-end-trigger", label: "バトル終了時の誘発",
    quotes: ["バトル終了時、"], evidence: "dsl.ts TimingMap / conditionalTriggers.ts: no battle-end trigger; BATTLE_END is a duration" },
  { feature: "damage-replacement", label: "被ダメージの置換",
    quotes: ["自分がダメージを受ける場合、代わりに"], evidence: "replacementPlans.ts / battle.ts: move replacement is not damage replacement" }
];
const labels = new Map(probes.map(probe => [probe.feature, probe.label]));
const classes = {
  approved: "承認済み", candidate: "対応候補", partial: "一部対応",
  unsupported: "未対応", ruling: "要裁定", unassessed: "未判定"
};
const fields = { text: "テキスト", triggerText: "トリガー" };
const sorted = values => [...new Set(values)].sort();
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const absence = text => text === "-" ? "" : text;
const assert = (value, message) => { if (!value) throw Error(message); };

function candidatesFor(input, ledger) {
  if (input === undefined) return new Map();
  dataObject(input, ["version", "sourceCsvSha256", "registryHash", "cards"]);
  assert(input.version === "v3-coverage-candidates.1" && input.sourceCsvSha256 === ledger.sourceSha256, "Candidate CSV SHA-256 mismatch");
  assert(input.registryHash === inventory.registryHash, "Candidate Registry SHA-256 mismatch");
  dataArray(input.cards, ledger.cards.length);
  const source = new Map(ledger.cards.map(card => [card.cardId, card]));
  const entries = new Map();
  for (const entry of input.cards) {
    dataObject(entry, ["cardId", "variantSha256"], ["definition", "findings", "supportedEvidence", "generation"]);
    const card = source.get(entry.cardId);
    const variant = card?.variants.find(row => row.pairSha256 === entry.variantSha256);
    assert(variant && !entries.has(entry.cardId), "Unknown or duplicate candidate card/variant");
    if (Object.hasOwn(entry, "generation")) {
      const info = entry.generation;
      dataObject(info, ["version", "status", "noEffect", "recognized", "unresolved"]);
      assert(info.version === "v3-draft-generator.1" && ["complete", "partial", "unconvertible", "unassessed"].includes(info.status) &&
        typeof info.noEffect === "boolean" && [info.recognized, info.unresolved].every(n => Number.isSafeInteger(n) && n >= 0) &&
        (info.status === "complete") === Object.hasOwn(entry, "definition") &&
        (info.status !== "complete" || info.unresolved === 0) &&
        (!info.noEffect || info.status === "complete" && info.recognized === 0 &&
          [variant.text, variant.triggerText].every(text => absence(text) === "")), "Invalid generated coverage metadata");
    }
    if (entry.supportedEvidence !== undefined) {
      assert(typeof entry.supportedEvidence === "string" && entry.supportedEvidence.trim() && entry.supportedEvidence.length <= 1000, "Invalid supported evidence");
    }
    const findings = Object.hasOwn(entry, "findings") ? entry.findings : [];
    dataArray(findings, 32);
    for (const row of findings) {
      dataObject(row, ["kind", "feature", "field", "quote", "evidence"]);
      assert(["unsupported", "ruling", "unknown"].includes(row.kind) && typeof row.feature === "string" &&
        /^[a-z][a-z0-9-]{0,79}$/.test(row.feature) && Object.hasOwn(fields, row.field) &&
        typeof row.quote === "string" && row.quote.trim() && row.quote.length <= 512 && variant[row.field].includes(row.quote) &&
        typeof row.evidence === "string" && row.evidence.trim() && row.evidence.length <= 1000, "Invalid finding or quote absent from pinned variant");
    }
    entries.set(entry.cardId, { ...entry, findings: findings.map(row => ({ ...row, variantSha256: entry.variantSha256, origin: "review-note" })) });
  }
  return entries;
}

export function collectProbes(variants) {
  if (!probesEnabled) return [];
  return variants.flatMap(variant => probes.flatMap(probe => Object.keys(fields).flatMap(field => {
    const quote = probe.quotes.find(value => variant[field].includes(value));
    return quote ? [{ kind: "unsupported", feature: probe.feature, field, quote, evidence: probe.evidence,
      variantSha256: variant.pairSha256, origin: "literal-probe" }] : [];
  })));
}

function checkDraft(entry, rawRows, candidate) {
  if (!entry || !Object.hasOwn(entry, "definition")) return { conversion: "not_supplied", compiler: "not_checked", runtime: "not_checked" };
  let plan;
  try { plan = compileV3CardJson(JSON.stringify(entry.definition)); }
  catch (error) { return { conversion: "draft", compiler: "failed", runtime: "not_checked", compilerError: error.message.slice(0, 512) }; }
  const d = plan.definition;
  const variant = candidate.variants.find(row => row.pairSha256 === entry.variantSha256);
  const matches = d.cardId === entry.cardId && d.source.text === absence(variant.text) && d.source.triggerText === absence(variant.triggerText) &&
    d.source.displayIds.every(id => variant.displayIds.includes(id)) &&
    rawRows.some(row => d.source.displayIds.includes(row.displayId) && variant.recordNumbers.includes(row.recordNumber) &&
      reviewedPrintedDifferences(row.raw, d).length === 0);
  return { conversion: matches ? "draft" : "source_mismatch", compiler: "passed",
    runtime: supportsV3RuntimeProfile(plan) ? "profile_compatible_not_executed" : "profile_mismatch",
    schema: d.schemaVersion, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, requiredHandlers: plan.requiredHandlers };
}

export function analyzeV3Coverage(reviewed, sourceBytes, { auditLedger, candidates } = {}) {
  const ledger = ledgerFromCsv(sourceBytes);
  if (auditLedger !== undefined) assert(isDeepStrictEqual(ledger, auditLedger), "Audit ledger does not match regenerated CSV ledger");
  const entries = candidatesFor(candidates, ledger);
  const diff = compareReviewedV3Ledger(reviewed, ledger), rowsByCard = new Map();
  for (const row of ledger.rows) {
    if (!rowsByCard.has(row.cardId)) rowsByCard.set(row.cardId, []);
    rowsByCard.get(row.cardId).push(row);
  }
  const cards = diff.cards.flatMap(row => {
    const candidate = row.candidate;
    if (!candidate) return [];
    const raw = rowsByCard.get(row.cardId), entry = entries.get(row.cardId), variants = candidate.variants;
    const displayIds = sorted(raw.map(line => line.displayId)), reasons = [...candidate.reasons];
    const approval = row.currentApproval;
    const currentApproval = approval && row.status !== "quarantine" && row.changedFields.every(field => field === "displayIds") &&
      approval.displayIds.every(id => displayIds.includes(id));
    if (approval && !currentApproval) reasons.push("approval-source-unconfirmed");
    const unapprovedDisplays = displayIds.filter(id => !approval?.displayIds.includes(id));
    const findings = [...collectProbes(variants), ...(entry?.findings ?? [])];
    const draft = checkDraft(entry, raw, candidate);
    if (draft.conversion === "source_mismatch") reasons.push("candidate-source-mismatch");
    if (draft.runtime === "profile_mismatch") reasons.push("runtime-profile-mismatch");
    if (findings.some(finding => finding.kind === "unknown")) reasons.push("review-unknown");
    const canReview = draft.compiler === "passed" && draft.conversion === "draft" && draft.runtime === "profile_compatible_not_executed";
    const classification = findings.some(finding => finding.kind === "ruling") || reasons.includes("text-trigger-variant-conflict") ? "ruling" :
      row.status === "quarantine" || reasons.includes("review-unknown") ? "unassessed" :
      findings.some(finding => finding.kind === "unsupported") ? (canReview && entry?.supportedEvidence ? "partial" : "unsupported") :
      currentApproval ? "approved" : canReview ? "candidate" : "unassessed";
    return [{ cardId: row.cardId, names: sorted(raw.map(line => line.raw["カード名"])), displayIds, classification,
      sourceCsvSha256: ledger.sourceSha256, variants, sourceUrls: sorted(raw.map(line => line.raw["出典URL"]).filter(Boolean)),
      approval: approval ? { ...approval, sourceConfirmed: Boolean(currentApproval), compiler: "verified_by_catalog",
        runtime: supportsV3RuntimeProfile(reviewed.catalog.get(row.cardId)) ? "profile_compatible_not_executed" : "profile_mismatch" } : null, unapprovedDisplays,
      draft, findings, reasons: sorted(reasons), supportedEvidence: entry?.supportedEvidence ?? null,
      ...(entry?.generation ? { generation: entry.generation } : {}) }];
  });
  const counts = Object.fromEntries(Object.keys(classes).map(key => [key, 0])), impact = new Map();
  for (const card of cards) {
    counts[card.classification]++;
    for (const feature of sorted(card.findings.filter(row => row.kind === "unsupported").map(row => row.feature))) {
      impact.set(feature, (impact.get(feature) ?? 0) + 1);
    }
  }
  const gaps = [...impact].map(([feature, count]) => ({ feature, label: labels.get(feature) ?? feature, count }))
    .sort((a, b) => b.count - a.count || lexical(a.feature, b.feature));
  return { sourceCsvSha256: ledger.sourceSha256, registryHash: inventory.registryHash, total: cards.length, counts, gaps, cards, ledgerVerified: auditLedger !== undefined,
    reviewedMissingFromCsv: diff.cards.filter(row => !row.candidate).length, probesEnabled };
}

export function renderV3Coverage(report) {
  const json = value => JSON.stringify(value);
  const table = [["card_id", "card_names", "display_ids", "classification", "source_csv_sha256", "raw_variants", "source_urls",
    "approval", "unapproved_display_ids", "dsl_conversion", "compiler", "runtime", "draft_details", "findings", "review_reasons", "supported_evidence", "generation"],
    ...report.cards.map(card => [card.cardId, json(card.names), json(card.displayIds), classes[card.classification], card.sourceCsvSha256,
      json(card.variants), json(card.sourceUrls), json(card.approval), json(card.unapprovedDisplays),
      card.draft.conversion === "not_supplied" && card.approval?.sourceConfirmed ? "reviewed_definition" : card.draft.conversion,
      card.draft.compiler === "not_checked" && card.approval?.sourceConfirmed ? card.approval.compiler : card.draft.compiler,
      card.draft.runtime === "not_checked" && card.approval?.sourceConfirmed ? card.approval.runtime : card.draft.runtime,
      json(card.draft), json(card.findings), json(card.reasons), card.supportedEvidence ?? "", card.generation ? json(card.generation) : ""])];
  const markdown = ["# カード効果対応状況", "", `- CSV SHA-256: \`${report.sourceCsvSha256}\``,
    `- Registry SHA-256: \`${report.registryHash}\``,
    `- カード番号: ${report.total}件。入力にない既存承認: ${report.reviewedMissingFromCsv}件。`,
    `- 監査台帳: ${report.ledgerVerified ? "既存台帳と照合済み" : "CSVから再生成"}。明示文言の検出: ${report.probesEnabled ? "有効" : "現行Registryと異なるため無効"}。`,
    "", "| 分類 | 件数 | 入力に占める割合 |", "| --- | ---: | ---: |",
    ...Object.entries(classes).map(([key, label]) => `| ${label} | ${report.counts[key]} | ${(report.total ? report.counts[key] / report.total * 100 : 0).toFixed(2)}% |`),
    "", "## 未対応機能", "", "| 機能 | ID | 影響するカード番号 |", "| --- | --- | ---: |",
    ...report.gaps.map(gap => `| ${gap.label} | \`${gap.feature}\` | ${gap.count} |`),
    "", "同じカード番号は機能ごとに1件。重複機能は別集計。未判定やCompiler成功を意味的対応・承認として数えていません。", ""].join("\n");
  const summaryCsv = csv([["section", "key", "label", "count"], ["total", "card_ids", "カード番号", report.total],
    ...Object.entries(classes).map(([key, label]) => ["classification", key, label, report.counts[key]]),
    ...report.gaps.map(gap => ["unsupported_feature", gap.feature, gap.label, gap.count])]);
  return { csv: csv(table), markdown, summaryCsv };
}

export function writeV3Coverage(root, output, report) {
  const directory = resolveReviewOutput(root, output), rendered = renderV3Coverage(report);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "coverage.csv"), rendered.csv, { flag: "wx" });
  fs.writeFileSync(path.join(directory, "summary.csv"), rendered.summaryCsv, { flag: "wx" });
  fs.writeFileSync(path.join(directory, "summary.md"), rendered.markdown, { flag: "wx" });
}

function readJson(file) {
  assert(fs.statSync(file).size <= 64 * 1024 * 1024, "Input JSON exceeds 64 MiB");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, source, output, ...flags] = process.argv.slice(2), options = {};
    assert(root && source && output && flags.length % 2 === 0, "Usage: analyze-v3-coverage.js <catalog-dir> <source.csv> <new-output-dir> [--ledger file.json] [--candidates file.json]");
    for (let i = 0; i < flags.length; i += 2) {
      const key = { "--ledger": "auditLedger", "--candidates": "candidates" }[flags[i]];
      assert(key && !Object.hasOwn(options, key), "Unknown or duplicate option");
      options[key] = readJson(flags[i + 1]);
    }
    assert(fs.statSync(source).size <= 25 * 1024 * 1024, "Input CSV exceeds 25 MiB");
    const report = analyzeV3Coverage(loadReviewedV3Catalog(root), fs.readFileSync(source), options);
    writeV3Coverage(root, output, report);
    console.log(JSON.stringify({ total: report.total, counts: report.counts, gaps: report.gaps.slice(0, 10) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
