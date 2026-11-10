import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReviewOutput } from "./review-v3-catalog.js";
import { v3DraftRegistry } from "./analyze-v3-coverage.js";
import { classifyTriggerSelfPlay } from "./v3-trigger-self-play.js";

const key = ({ cardId, variantSha256, field, start, end }) => JSON.stringify([cardId, variantSha256, field, start, end]);
const assert = (ok, message) => { if (!ok) throw Error(message); };
const cohort = row => row.field === "triggerText" && row.findings.some(f => f.feature.startsWith("trigger-self-play"));
const patternPrefix = "pr28-trigger-self-play-";
function index(trace) {
  return new Map(trace.cards.flatMap(card => card.variants.flatMap(variant => variant.spans.map(span => [
    key({ ...span, cardId: card.cardId, variantSha256: variant.pairSha256 }), { span, status: card.status }
  ]))));
}
const count = rows => ({ cards: new Set(rows.map(row => row.cardId)).size, spans: rows.length });

export function compareTriggerPlayCohort(pr26, pr27, pr28) {
  const sourceCsvSha256 = pr26.summary.sourceCsvSha256;
  assert(pr26.summary.version === "v3-draft-details.1" && pr26.summary.executable === false &&
    pr26.summary.registryHash === v3DraftRegistry("v3-draft-generator.6"), "Expected pinned PR26 details");
  for (const [trace, version] of [[pr27, "v3-draft-generator.7"], [pr28, "v3-draft-generator.8"]])
    assert(trace.executable === false && trace.version === version && trace.sourceCsvSha256 === sourceCsvSha256 &&
      trace.registryHash === v3DraftRegistry(version), "Trace version, CSV or Registry mismatch");
  const before = index(pr27), after = index(pr28), seen = new Set();
  const rows = pr26.spans.filter(cohort).map(({ cardId, variantSha256, displayIds, field, start, end, raw }) => {
    const row = { cardId, variantSha256, displayIds, field, start, end, raw };
    const id = key(row), old = before.get(id), current = after.get(id);
    assert(!seen.has(id) && old?.span.text === raw && current?.span.text === raw, `Duplicate or changed source span: ${id}`);
    seen.add(id);
    const body = /^(?:【トリガー】|〖トリガー〗)([\s\S]+)$/u.exec(raw.trim())?.[1]?.trim() ?? "";
    const classification = classifyTriggerSelfPlay(body);
    return { ...row, ...classification, priorStatus: old.status, currentStatus: current.status, before: old.span.status, after: current.span.status,
      generated: old.span.status !== "recognized" && current.span.status === "recognized" && current.span.pattern?.startsWith(patternPrefix) === true };
  });
  const generated = rows.filter(row => row.generated);
  return { summary: { sourceCsvSha256, executable: false, ...count(rows),
    alreadyRecognized: count(rows.filter(row => row.before === "recognized")),
    categories: Object.fromEntries(["unconditional", "conditional", "payment", "unconfirmed"].map(kind => [kind, count(rows.filter(row => row.kind === kind))])),
    recognized: count(generated), patterns: Object.fromEntries([...new Set(generated.map(row => row.pattern))].sort().map(pattern => [
      pattern, count(generated.filter(row => row.pattern === pattern))
    ])), held: count(rows.filter(row => row.after !== "recognized")) }, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [pr26, pr27, pr28, output] = process.argv.slice(2);
    assert(process.argv.length === 6, "Usage: analyze-v3-trigger-play.js <pr26-details> <pr27-trace> <pr28-trace> <new-report-dir>");
    const read = file => {
      assert(fs.statSync(file).size <= 64 * 1024 * 1024, "Analysis input exceeds 64 MiB");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    };
    const result = compareTriggerPlayCohort(read(pr26), read(pr27), read(pr28));
    const catalog = fileURLToPath(new URL("../server/data/effects-v3-reviewed", import.meta.url));
    const directory = resolveReviewOutput(catalog, output);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "trigger-play.json"), JSON.stringify(result) + "\n", { flag: "wx" });
    console.log(JSON.stringify(result.summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
