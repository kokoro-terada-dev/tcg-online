import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./build-card-master.js";
const require = createRequire(import.meta.url);
const { SOURCE_COLUMNS, REVIEW_FIELDS, validateReviewBundle } = require("../server/dist/test/effects/v3/cardData.js");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const numeric = new Set(["コスト", "ライフ", "パワー", "カウンター"]);
export function normalizeComparison(value) {
  // Comparison hints only. Never use this to infer effect semantics or overwrite raw text.
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replaceAll("‼", "!!").replace(/[ \t\u3000]+/g, " ").replace(/\n[ \t]*\n+/g, "\n").trim();
}
export function auditCards(raw, sourceSha256 = sha(Buffer.from(raw))) {
  const [header, ...rows] = parseCsv(raw, { trim: false });
  if (!header || header.length !== SOURCE_COLUMNS.length || new Set(header).size !== header.length || SOURCE_COLUMNS.some(key => !header.includes(key))) throw new Error("Expected the 20 official-source CSV columns");
  const groups = new Map(), displayIds = new Set(), anomalies = [], variants = [];
  const issue = (recordNumber, cardId, field, reason, value) => anomalies.push({ recordNumber, cardId, field, reason, value });
  rows.forEach((values, index) => {
    const recordNumber = index + 2;
    if (values.length !== header.length) throw new Error(`Record ${recordNumber}: wrong column count`);
    const source = Object.fromEntries(header.map((key, i) => [key, values[i]]));
    const cardId = source["カード番号"].trim(), displayId = source["表示ID"].trim(), issues = [];
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(cardId) || ["constructor", "prototype"].includes(cardId)) throw new Error(`Record ${recordNumber}: invalid card number`);
    const addIssue = (field, reason) => { issues.push(`${field}:${reason}`); issue(recordNumber, cardId, field, reason, source[field]); };
    if (!displayId || displayId.length > 100 || displayIds.has(displayId)) addIssue("表示ID", "missing-or-duplicate");
    displayIds.add(displayId);
    if (!["LEADER", "CHARACTER", "EVENT", "STAGE", "DON"].includes(source["種類"].trim())) addIssue("種類", "unknown-type");
    for (const field of numeric) {
      const value = source[field].trim();
      if (!["", "-", "null", "NULL"].includes(value) && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) addIssue(field, "invalid-number");
    }
    if (!source["カード名"].trim()) addIssue("カード名", "missing");
    if (!source["テキスト"].trim()) addIssue("テキスト", "missing");
    const normalized = Object.fromEntries(REVIEW_FIELDS.map(field => [field, normalizeComparison(source[field])]));
    const variant = { cardId, displayId, recordNumber, raw: source, normalized, issues };
    variants.push(variant);
    if (!groups.has(cardId)) groups.set(cardId, []);
    groups.get(cardId).push(variant);
  });
  const differences = [], cards = [], tags = new Map();
  for (const [cardId, versions] of groups) {
    const consensus = Object.create(null), reasons = ["no-semantic-parser-or-human-approval"];
    for (const field of REVIEW_FIELDS) {
      const rawValues = new Set(versions.map(v => v.raw[field])), normalized = new Set(versions.map(v => v.normalized[field]));
      if (rawValues.size > 1) {
        differences.push({ cardId, field, rawValueCount: rawValues.size, normalizedValueCount: normalized.size, classification: normalized.size === 1 ? "normalization-only-needs-review" : "content-difference-needs-review", recordNumbers: versions.map(v => v.recordNumber) });
        reasons.push(`variant-difference:${field}`);
      }
      if (normalized.size === 1) consensus[field] = [...normalized][0];
    }
    for (const variant of versions) for (const match of variant.raw["テキスト"].matchAll(/【([^】]+)】/g)) {
      const tag = normalizeComparison(match[1]); if (!tags.has(tag)) tags.set(tag, new Set()); tags.get(tag).add(cardId);
    }
    const unsupported = versions.some(v => v.issues.length > 0);
    cards.push({ cardId, recordNumbers: versions.map(v => v.recordNumber), reviewStatus: unsupported ? "unsupported" : "needs_review", parseStatus: unsupported ? "unsupported" : "needs_review", reasons: [...reasons, ...(unsupported ? ["invalid-source-data"] : [])], consensus, effects: [] });
  }
  const bundle = validateReviewBundle({ schemaVersion: "3.0-review.1", sourceSha256, normalizationVersion: "comparison-only.1", cards, variants });
  return { bundle, anomalies, differences, tags: [...tags].map(([tag, ids]) => ({ tag, cardCount: ids.size })),
    summary: { sourceRows: variants.length, uniqueCards: cards.length, rawDifferingFields: differences.length, normalizedDifferingFields: differences.filter(v => v.normalizedValueCount > 1).length,
      anomalyRows: new Set(anomalies.map(v => v.recordNumber)).size, parsed: 0, needs_review: cards.filter(v => v.reviewStatus === "needs_review").length, unsupported: cards.filter(v => v.reviewStatus === "unsupported").length, approved: 0, semanticApprovalRate: 0, executable: false } };
}
const csv = rows => "\uFEFF" + rows.map(row => row.map(value => {
  const raw = String(value ?? ""), text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}).join(",")).join("\r\n") + "\r\n";
export function runAudit(input, output, encoding = "utf-8", referenceDir = path.dirname(input)) {
  if (!["utf-8", "shift_jis"].includes(encoding)) throw new Error("Encoding must be utf-8 or shift_jis");
  const bytes = fs.readFileSync(input);
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Input exceeds 25 MiB");
  const result = auditCards(new TextDecoder(encoding, { fatal: true }).decode(bytes), sha(bytes));
  const references = ["effect_engine_v3_codex_spec.md", "effect_dsl_example.json", "representative_card_cases.json", "variant_conflicts.csv", "effect_tag_vocabulary.csv", "effect_pattern_counts.csv"].map(name => {
    const file = path.join(referenceDir, name);
    if (!fs.existsSync(file)) throw new Error(`Missing reference: ${file}`);
    const bytes = fs.readFileSync(file); let records;
    if (name.endsWith(".csv")) records = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes), { trim: false }).length - 1;
    if (name.endsWith(".json")) {
      const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      records = Array.isArray(data) ? data.length : data.effects?.length;
      if (name === "representative_card_cases.json" && (!Array.isArray(data) || data.some(item => !result.bundle.cards.some(card => card.cardId === item.cardId)))) throw new Error("Representative card missing from source");
    }
    return { name, bytes: bytes.length, sha256: sha(bytes), ...(records === undefined ? {} : { records }) };
  });
  const suppliedConflicts = parseCsv(fs.readFileSync(path.join(referenceDir, "variant_conflicts.csv"), "utf8")).slice(1);
  const attachedKeys = new Set(suppliedConflicts.map(row => `${row[0]}|${row[1]}`));
  const actualKeys = new Set(result.differences.map(row => `${row.cardId}|${row.field}`));
  const referenceChecks = {
    conflicts: { supplied: suppliedConflicts.length, detected: result.differences.length,
      additionalDetected: [...actualKeys].filter(key => !attachedKeys.has(key)), suppliedNotDetected: [...attachedKeys].filter(key => !actualKeys.has(key)) },
    dslExample: "illustrative-only-not-compiled", representativeCases: "source-presence-checked-not-rule-validated",
    patternCounts: "reference-string-counts-not-semantic-coverage", tags: "observed-only-not-executable-commands",
  };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(output); // No overwriting prior audits.
  fs.mkdirSync(path.join(output, "sources"));
  fs.copyFileSync(input, path.join(output, "sources", "onepiece_cards_ja.csv"));
  for (const reference of references) fs.copyFileSync(path.join(referenceDir, reference.name), path.join(output, "sources", reference.name));
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  write("card-review.json", result.bundle);
  write("summary.json", { ...result.summary, sourceSha256: sha(bytes), encoding, references, referenceChecks });
  write("tag-observations.json", result.tags);
  write("variant-differences.json", result.differences);
  fs.writeFileSync(path.join(output, "anomalies.csv"), csv([["recordNumber", "cardId", "field", "reason", "value"], ...result.anomalies.map(v => [v.recordNumber, v.cardId, v.field, v.reason, v.value])]), { flag: "wx" });
  fs.writeFileSync(path.join(output, "variant-differences.csv"), csv([["cardId", "field", "rawValueCount", "normalizedValueCount", "classification", "recordNumbers"], ...result.differences.map(v => [v.cardId, v.field, v.rawValueCount, v.normalizedValueCount, v.classification, v.recordNumbers.join("|")])]), { flag: "wx" });
  return result.summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length < 2 || args.length > 3) throw new Error("Usage: npm run audit:effect-cards -- <input.csv> <new-output-directory> [utf-8|shift_jis]");
    console.log(JSON.stringify(runAudit(path.resolve(args[0]), path.resolve(args[1]), args[2]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
