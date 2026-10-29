import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { auditCards } from "./audit-effect-cards.js";
const { createReviewLedger } = createRequire(import.meta.url)("../server/dist/test/effects/v3/reviewLedger.js");

export function ledgerFromCsv(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 25 * 1024 * 1024) throw Error("Expected CSV bytes up to 25 MiB");
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return createReviewLedger(auditCards(raw, sourceSha256).bundle);
}

export function writeReviewLedger(inputFile, outputDirectory) {
  const bytes = fs.readFileSync(inputFile), ledger = ledgerFromCsv(bytes);
  const output = path.resolve(outputDirectory);
  // New directory only. Never updates a prior audit, input CSV, or trusted manifest.
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, "source.csv"), bytes, { flag: "wx" });
  fs.writeFileSync(path.join(output, "review-ledger.json"), JSON.stringify(ledger, null, 2) + "\n", { flag: "wx" });
  const summary = { version: ledger.version, executable: false, sourceSha256: ledger.sourceSha256, rows: ledger.rows.length, cards: ledger.cards.length,
    textVariantConflicts: ledger.cards.filter(card => card.variants.length > 1).length,
    quarantine: ledger.cards.filter(card => card.disposition === "quarantine").length, approved: 0 };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw Error("Usage: node tools/build-v3-review-ledger.js <utf8-source.csv> <new-output-directory>");
    console.log(JSON.stringify(writeReviewLedger(process.argv[2], process.argv[3]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
