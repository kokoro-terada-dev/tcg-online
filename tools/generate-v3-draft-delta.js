import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { generateV3Drafts } from "./generate-v3-drafts.js";
import { resolveReviewOutput } from "./review-v3-catalog.js";

const require = createRequire(import.meta.url);
const [root, source, ledgerFile, baseline, output, ...flags] = process.argv.slice(2);
const powerIndex = flags.indexOf("--confirmed-power");
const powerFile = powerIndex < 0 ? null : flags[powerIndex + 1];
if (powerIndex >= 0 && !powerFile) throw Error("Missing confirmed power file");
if (powerFile) flags.splice(powerIndex, 2);
const sets = flags;
if (!output || sets.some(set => !/^(?:EB|OP|ST)[0-9]{2}$/u.test(set)))
  throw Error("Usage: generate-v3-draft-delta.js <catalog> <source.csv> <ledger.json> <generation.json> <new-output-dir> [set ...] [--confirmed-power file.json]");
const directory = resolveReviewOutput(root, output);
if (fs.existsSync(directory)) throw Error("Output directory already exists");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const ledger = read(ledgerFile), prior = read(baseline);
const sha = createHash("sha256").update(fs.readFileSync(source)).digest("hex");
const ids = new Set(prior.cards.map(c => c.cardId));
if (sha !== ledger.sourceSha256 || sha !== prior.sourceCsvSha256 || prior.executable !== false ||
    ids.size !== prior.cards.length || ids.size !== ledger.cards.length || !ledger.cards.every(c => ids.has(c.cardId)))
  throw Error("Baseline and ledger must cover the same source snapshot");
const states = new Set(["complete", "partial", "unconvertible", "unassessed"]);
if (prior.cards.some(c => !states.has(c.status))) throw Error("Invalid baseline status");
const inScope = c => !sets.length || sets.includes(c.cardId.split("-")[0]);
const selected = prior.cards.filter(c => c.status !== "complete" && inScope(c)).map(c => c.cardId);
if (!selected.length) throw Error("No unfinished cards");
const catalogRoot = fs.realpathSync(root), index = read(path.join(catalogRoot, "catalog-root.json"));
const approved = new Set();
for (const entry of [index.legacy, ...index.shards]) {
  const file = fs.realpathSync(path.join(catalogRoot, entry.file));
  const relative = path.relative(catalogRoot, file);
  if (!relative || path.isAbsolute(relative) || relative.startsWith(".." + path.sep)) throw Error("Catalog manifest outside catalog");
  const { cards } = read(file);
  if (cards.length !== entry.cardCount) throw Error("Catalog manifest count mismatch");
  for (const { approval } of cards) {
    if (approval.status !== "approved" || typeof approval.cardId !== "string" || approved.has(approval.cardId))
      throw Error("Invalid or duplicate approval metadata");
    approved.add(approval.cardId);
  }
}
const validate = require("../docs/validate-card-effect-json.cjs").createSchemaValidator();
const confirmations = powerFile ? read(powerFile) : null;
const confirmed = new Map();
if (confirmations) {
  if (confirmations.sourceCsvSha256 !== sha || !Array.isArray(confirmations.cards)) throw Error("Invalid power confirmation snapshot");
  const eligible = new Set(selected);
  for (const entry of confirmations.cards) {
    const rows = ledger.rows.filter(row => row.cardId === entry.cardId);
    if (!eligible.has(entry.cardId) || approved.has(entry.cardId) || confirmed.has(entry.cardId) ||
        !Number.isSafeInteger(entry.power) || entry.power < 0 || !entry.evidence?.trim() || !rows.length ||
        rows.some(row => row.raw["種類"] !== "CHARACTER" || row.raw["パワー"] !== "-"))
      throw Error("Invalid or out-of-scope power confirmation: " + entry.cardId);
    confirmed.set(entry.cardId, entry);
  }
}
const selectedIds = new Set(selected);
const normalized = new Map();
const draftLedger = { ...ledger, rows: ledger.rows.map(row => {
  if (!selectedIds.has(row.cardId) || approved.has(row.cardId)) return row;
  const raw = row.raw, kind = raw["種類"], fields = {};
  if (kind === "EVENT" && raw["パワー"] !== "-") fields["パワー"] = "-";
  if ((kind === "CHARACTER" || kind === "LEADER") && raw["パワー"] === "-")
    fields["パワー"] = String(confirmed.get(row.cardId)?.power ?? 0);
  if (["CHARACTER", "STAGE", "EVENT"].includes(kind) && raw["コスト"] === "-") fields["コスト"] = "0";
  if (!Object.keys(fields).length) return row;
  if (!normalized.has(row.cardId)) normalized.set(row.cardId, new Set());
  for (const field of Object.keys(fields)) normalized.get(row.cardId).add(field);
  return { ...row, raw: { ...raw, ...fields } };
}) };
const { trace, candidates, schemaHolds } = generateV3Drafts(draftLedger, selected, undefined, validate, { delta: true, excludeApproved: approved });
trace.version = "v3-draft-delta.1";
const profile = ["3.0.0-subset.62", "3.0.0-subset.61", "3.0.0-subset.60", "3.0.0-subset.59", "3.0.0-subset.58", "3.0.0-subset.57", "3.0.0-subset.56", "3.0.0-subset.55", "3.0.0-subset.54"].find(version =>
  candidates.cards.some(c => c.definition?.schemaVersion === version)) ?? "3.0.0-subset.53";
trace.registryHash = require("../docs/card-effect-supported-operations.json").profiles[profile].registryHash;
const definitions = candidates.cards.filter(c => c.definition && !approved.has(c.cardId));
for (const { cardId, definition } of definitions)
  if (!/^[A-Z0-9][A-Z0-9-]{0,99}$/u.test(cardId) || /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/iu.test(cardId) ||
      definition.reviewStatus !== "needs_review" || definition.cardId !== cardId)
    throw Error("Unsafe draft export");
fs.mkdirSync(directory);
fs.mkdirSync(path.join(directory, "definitions"));
const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
for (const { cardId, definition } of definitions) write(`definitions/${cardId}.json`, definition);
write("generation.json", trace);
write("schema-holds.json", schemaHolds);
if (confirmations) write("printed-confirmations.json", confirmations);
write("printed-normalization.json", { sourceCsvSha256: sha, policy: "required-power-and-cost-dash-to-zero; ignore-event-power",
  cards: [...normalized].map(([cardId, fields]) => ({ cardId, fields: [...fields] })) });
const status = new Map(trace.cards.map(c => [c.cardId, c]));
// Carry forward status metadata only, without loading or compiling old definitions.
const merged = prior.cards.map(c => c.status === "complete" ? { cardId: c.cardId, status: c.status } : status.get(c.cardId) ?? c);
const counts = cards => {
  const result = Object.fromEntries([...states].map(state => [state, 0]));
  for (const card of cards) result[card.status]++;
  return result;
};
const cumulative = counts(merged);
write("remaining-input.json", { ...trace, cards: merged, totals: { sourceCards: merged.length, counts: cumulative } });
const progress = Object.fromEntries(["EB05", "OP17", "OP16", "EB04", ...sets].map(set => {
  const matches = c => c.cardId.startsWith(set + "-");
  return [set, { before: counts(prior.cards.filter(matches)), after: counts(merged.filter(matches)) }];
}));
write("set-progress.json", progress);
if (sets.length) {
  const holds = merged.filter(c => inScope(c) && c.status !== "complete").map(c => ({
    cardId: c.cardId, status: c.status, reasons: c.reasons,
    unresolved: c.variants.flatMap(v => v.spans.filter(s => s.status !== "recognized")
      .map(s => ({ field: s.field, start: s.start, end: s.end, text: s.text, reason: s.reason, unparsed: s.unparsed })))
  }));
  const rowsById = new Map();
  for (const row of ledger.rows) {
    if (!rowsById.has(row.cardId)) rowsById.set(row.cardId, row.raw);
  }
  for (const hold of holds) {
    if (!hold.reasons.includes("printed-metadata-unconfirmed")) continue;
    const raw = rowsById.get(hold.cardId);
    hold.printedMetadata = { type: raw["種類"], cost: raw["コスト"], power: raw["パワー"], counter: raw["カウンター"] };
  }
  write("set-holds.json", holds);
}
console.log(JSON.stringify({ ...trace.totals, cumulative, files: definitions.length, schemaHolds: schemaHolds.length,
  approvedExcluded: selected.filter(id => approved.has(id)).length }));
