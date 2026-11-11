import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { generateV3Drafts } from "./generate-v3-drafts.js";
import { resolveReviewOutput } from "./review-v3-catalog.js";

const require = createRequire(import.meta.url);
const [root, source, ledgerFile, baseline, output, ...sets] = process.argv.slice(2);
if (!output || sets.some(set => !/^(?:EB|OP|ST)[0-9]{2}$/u.test(set)))
  throw Error("Usage: generate-v3-draft-delta.js <catalog> <source.csv> <ledger.json> <generation.json> <new-output-dir> [set ...]");
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
const { trace, candidates, schemaHolds } = generateV3Drafts(ledger, selected, undefined, validate, { delta: true, excludeApproved: approved });
trace.version = "v3-draft-delta.1";
trace.registryHash = require("../docs/card-effect-supported-operations.json").profiles["3.0.0-subset.51"].registryHash;
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
