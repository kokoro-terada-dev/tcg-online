import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";

const { loadReviewedV3Catalog, proposeReviewedV3Index } = createRequire(import.meta.url)("../server/dist/test/effects/v3/reviewedCatalog.js");
const absence = value => value === "-" ? "" : value;
const sorted = values => [...values].sort();
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function reviewedPrintedDifferences(raw, d) {
  const numeric = v => ["", "-", "null", "NULL"].includes(v.trim()) ? null : /^\d+$/.test(v.trim()) ? Number(v) : v;
  const labels = v => v === "-" || v === "" ? [] : v.split("/");
  const fields = {
    name: [raw["カード名"], d.name], cardType: [raw["種類"], d.cardType.toUpperCase()],
    cost: [numeric(raw["コスト"]), d.baseStats.cost], life: [numeric(raw["ライフ"]), d.baseStats.life],
    power: [numeric(raw["パワー"]), d.baseStats.power], counter: [numeric(raw["カウンター"]), d.baseStats.counter],
    colors: [labels(raw["色"]), d.colors], traits: [labels(raw["特徴"]), d.traits], attributes: [labels(raw["属性"]), d.attributes],
    text: [absence(raw["テキスト"]), d.source.text], triggerText: [absence(raw["トリガー"]), d.source.triggerText]
  };
  return Object.keys(fields).filter(field => !equal(...fields[field]));
}

export function compareReviewedV3Source(reviewed, bytes) {
  return compareReviewedV3Ledger(reviewed, ledgerFromCsv(bytes));
}

export function compareReviewedV3Ledger(reviewed, ledger) {
  const incoming = new Map(ledger.cards.map(card => [card.cardId, card]));
  const ids = sorted(new Set([...incoming.keys(), ...reviewed.cards.map(card => card.definition.cardId)]));
  const rowsByCard = new Map();
  for (const row of ledger.rows) {
    if (!rowsByCard.has(row.cardId)) rowsByCard.set(row.cardId, []);
    rowsByCard.get(row.cardId).push(row);
  }
  const cards = ids.map(cardId => {
    const approved = reviewed.catalog.get(cardId), candidate = incoming.get(cardId), rows = rowsByCard.get(cardId) ?? [];
    const raw = rows[0]?.raw;
    const changedFields = approved && raw ? sorted(new Set(rows.flatMap(row => reviewedPrintedDifferences(row.raw, approved.definition)))) : [];
    const displayIds = sorted(new Set(rows.map(row => row.displayId)));
    if (approved && candidate && !equal(displayIds, sorted(approved.definition.source.displayIds))) changedFields.push("displayIds");
    const status = !candidate ? "missing_from_input" : candidate.disposition === "quarantine" ? "quarantine" :
      !approved ? "new" : changedFields.length ? "changed" : "unchanged";
    return { cardId, status, executable: false, changedFields,
      currentApproval: approved ? { ...approved.approval, provenance: reviewed.sourceEvidenceFor(cardId),
        displayIds: approved.definition.source.displayIds, text: approved.definition.source.text, triggerText: approved.definition.source.triggerText } : null,
      candidate: candidate ? { sourceCsvSha256: ledger.sourceSha256, reviewStatus: candidate.reviewStatus, reasons: candidate.reasons, variants: candidate.variants } : null };
  });
  return { version: "v3-reviewed-diff.1", executable: false, sourceCsvSha256: ledger.sourceSha256, cards };
}

export function resolveReviewOutput(root, output) {
  const dest = path.resolve(fs.realpathSync(path.dirname(path.resolve(output))), path.basename(output));
  const relative = path.relative(fs.realpathSync(root), dest);
  if (!relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) throw Error("Output must be outside the trusted catalog directory");
  return dest;
}

export function writeProposal(root, output, data) {
  fs.writeFileSync(resolveReviewOutput(root, output), JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, root, output, ...args] = process.argv.slice(2);
    if (!root || !output || !["diff", "index"].includes(mode) || mode === "diff" && args.length !== 1) {
      throw Error("Usage: review-v3-catalog.js diff <catalog-dir> <new-report.json> <source.csv> | index <catalog-dir> <new-index.json> [shards/new.json | shards/old.json=shards/new.json ...]");
    }
    if (mode === "diff") {
      const report = compareReviewedV3Source(loadReviewedV3Catalog(root), fs.readFileSync(args[0]));
      writeProposal(root, output, report);
      console.log(JSON.stringify({ cards: report.cards.length }));
    } else {
      const additions = [], replacements = [];
      for (const arg of args) {
        const parts = arg.split("=");
        if (parts.length === 1) additions.push(arg);
        else if (parts.length === 2) replacements.push({ oldFile: parts[0], newFile: parts[1] });
        else throw Error("Invalid replacement path");
      }
      const { index, changes } = proposeReviewedV3Index(root, additions, replacements);
      writeProposal(root, output, index);
      console.log(JSON.stringify({ rootHash: index.rootHash, changes }));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
