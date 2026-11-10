import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./build-card-master.js";
import { csv } from "./audit-effect-cards.js";
import { resolveReviewOutput } from "./review-v3-catalog.js";
import { v3DraftRegistry } from "./analyze-v3-coverage.js";

const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const assert = (condition, message) => { if (!condition) throw Error(message); };
const catalogRoot = fileURLToPath(new URL("../server/data/effects-v3-reviewed", import.meta.url));
const classifications = ["承認済み", "対応候補", "一部対応", "未対応", "要裁定", "未判定"];
const spanKey = span => `${span.field}:${span.start}:${span.end}`;
const positive = (a, b) => b.cards - a.cards || b.spans - a.spans || lexical(a.pattern, b.pattern);

// Grouping only: none of this text reaches the DSL parser.
export const normalizeV3Gap = raw => raw.normalize("NFKC").replaceAll("〖", "【").replaceAll("〗", "】")
  .replace(/[\t\s]+/gu, " ").trim().replace(/[0-9]+/g, "#");

function indexCards(rows) {
  const map = new Map(rows.map(row => [row.cardId, row]));
  assert(map.size === rows.length, "Duplicate card ID in report");
  return map;
}
function coverage(csvText, hash) {
  const [header, ...rows] = parseCsv(csvText, { trim: false });
  const columns = ["card_id", "classification", "source_csv_sha256", "approval", "compiler"];
  const positions = columns.map(column => header?.indexOf(column) ?? -1);
  assert(positions.every(pos => pos >= 0), "Invalid coverage CSV columns");
  return indexCards(rows.map(row => {
    const [cardId, classification, sourceHash, approval, compiler] = positions.map(pos => row[pos]);
    assert(sourceHash === hash && classifications.includes(classification), "Mismatched coverage CSV");
    return { cardId, classification, approval: JSON.parse(approval), compiler };
  }));
}
function diagnosis(group) {
  if (group.resolved === group.spans) return ["existing", "全出現を既存DSLまたは既知注釈として解釈"];
  if (group.resolved) return ["context_required", "一部のみ解釈。残りは前後関係・タイミング・参照先の確認が必要"];
  if (group.unsupported === group.spans) return ["runtime_gap", "現行Runtimeにない動作を明示文言で確認"];
  if (group.mainUnconfirmed) return ["context_required", "呼び出し先のメイン本文が一意に確定していない"];
  if (group.field === "text" && /^\(このカード.*\)$/.test(group.pattern)) {
    return ["context_required", "注釈だけでは印刷キーワードか条件付き付与かを判定できない"];
  }
  if (group.field === "triggerText" && /^【トリガー】ドン!!デッキからドン!!#枚までを、/.test(group.pattern)) {
    return ["held", "固定枚数のDON追加では任意枚数・不足時の選択を保証できない"];
  }
  return ["unknown", "原文を安全に変換できず、既存DSLでの表現可否は未判定"];
}

export function compareV3DraftRuns(before, after, beforeCsv, afterCsv) {
  const versions = ["v3-draft-generator.1", "v3-draft-generator.2", "v3-draft-generator.3", "v3-draft-generator.4", "v3-draft-generator.5"];
  const baseline = versions.indexOf(before.version);
  const compatible = versions.indexOf(after.version) >= 3 ? before.registryHash === v3DraftRegistry(before.version) &&
    after.registryHash === v3DraftRegistry(after.version) : before.registryHash === after.registryHash;
  assert(baseline >= 0 && versions.indexOf(after.version) > baseline &&
    before.sourceCsvSha256 === after.sourceCsvSha256 && compatible &&
    before.totals.sourceCards === after.totals.sourceCards && before.cards.length === before.totals.sourceCards &&
    after.cards.length === after.totals.sourceCards, "Compare complete reports from the same CSV and Registry");
  const current = indexCards(after.cards), oldCoverage = coverage(beforeCsv, before.sourceCsvSha256), newCoverage = coverage(afterCsv, after.sourceCsvSha256);
  assert(indexCards(before.cards).size === current.size && oldCoverage.size === current.size && newCoverage.size === current.size, "Report card counts differ");
  const groups = new Map(), patterns = new Map(), approvedOverlap = [], cardChanges = [], regressions = [];
  let unresolved = 0;
  for (const previous of before.cards) {
    const next = current.get(previous.cardId), old = oldCoverage.get(previous.cardId), fresh = newCoverage.get(previous.cardId);
    assert(next && old && fresh && previous.variants.length === next.variants.length, "Report cards or variants differ");
    const now = new Map(next.variants.map(variant => [variant.pairSha256, variant]));
    if (previous.status === "complete" && old.classification !== "対応候補") {
      approvedOverlap.push({ cardId: previous.cardId, generation: previous.status, compiler: previous.compiler, coverage: old.classification,
        reason: old.approval?.sourceConfirmed && old.classification === "承認済み" ? "existing-approval-precedes-candidate" : "inspect-coverage" });
    }
    if (previous.status !== next.status || previous.compiler !== next.compiler || previous.unresolved !== next.unresolved ||
      old.classification !== fresh.classification || previous.definitionHash !== next.definitionHash) {
      cardChanges.push({ cardId: previous.cardId, before: previous.status, after: next.status, compilerBefore: previous.compiler, compilerAfter: next.compiler,
        coverageBefore: old.classification, coverageAfter: fresh.classification, unresolvedBefore: previous.unresolved, unresolvedAfter: next.unresolved,
        definitionHashBefore: previous.definitionHash ?? "", definitionHashAfter: next.definitionHash ?? "",
        reasonsBefore: previous.reasons ?? [], reasonsAfter: next.reasons ?? [] });
    }
    if (previous.status === "complete" && (next.status !== "complete" || next.compiler !== previous.compiler || next.definitionHash !== previous.definitionHash)) {
      regressions.push(previous.cardId);
    }
    for (const variant of previous.variants) {
      const updated = now.get(variant.pairSha256);
      assert(updated?.text === variant.text && updated.triggerText === variant.triggerText, "Raw variant changed");
      const spans = new Map(updated.spans.map(span => [spanKey(span), span]));
      for (const span of variant.spans) {
        if (span.status === "recognized") continue;
        const revised = spans.get(spanKey(span));
        assert(revised?.text === span.text, "Raw span changed");
        unresolved++;
        const pattern = normalizeV3Gap(span.text), key = `${span.field}:${pattern}`;
        if (!groups.has(key)) groups.set(key, { field: span.field, pattern, spans: 0, ids: new Set(), resolved: 0,
          resolvedIds: new Set(), unsupported: 0, mainUnconfirmed: 0, exampleCard: previous.cardId, example: span.text });
        const group = groups.get(key);
        group.spans++;
        group.ids.add(previous.cardId);
        if (revised.status === "unsupported") group.unsupported++;
        if (revised.reason === "main-body-unconfirmed") group.mainUnconfirmed++;
        if (revised.status !== "recognized") continue;
        group.resolved++;
        group.resolvedIds.add(previous.cardId);
        assert(revised.pattern, "Newly recognized span must identify its parser pattern");
        if (!patterns.has(revised.pattern)) patterns.set(revised.pattern, { spans: 0, ids: new Set(), newComplete: new Set() });
        const impact = patterns.get(revised.pattern);
        impact.spans++;
        impact.ids.add(previous.cardId);
        if (previous.status !== "complete" && next.status === "complete") impact.newComplete.add(previous.cardId);
      }
    }
  }
  assert(unresolved === before.totals.unresolvedSpans, "Baseline unresolved span total mismatch");
  const grouped = [...groups.values()].map(group => {
    const [expressibility, reason] = diagnosis(group), { ids, resolvedIds, unsupported: _unsupported, mainUnconfirmed: _main, ...rest } = group;
    return { ...rest, cards: ids.size, resolvedCards: resolvedIds.size, expressibility, reason };
  }).sort(positive);
  const improvements = [...patterns].map(([pattern, row]) => ({ pattern, spans: row.spans, cards: row.ids.size, newCompleteCards: row.newComplete.size })).sort(positive);
  const counts = rows => Object.fromEntries(classifications.map(status => [status, [...rows.values()].filter(row => row.classification === status).length]));
  return { sourceCsvSha256: before.sourceCsvSha256, before: before.totals, after: after.totals, coverageBefore: counts(oldCoverage), coverageAfter: counts(newCoverage),
    groups: grouped, improvements, approvedOverlap, cardChanges, regressions };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [before, after, output] = process.argv.slice(2);
    assert(process.argv.length === 5, "Usage: analyze-v3-draft-gaps.js <baseline-report> <newer-report> <new-output-dir>");
    const read = (directory, file) => {
      const source = path.join(directory, file);
      assert(fs.statSync(source).size <= 64 * 1024 * 1024, "Input report exceeds 64 MiB");
      return fs.readFileSync(source, "utf8");
    };
    const report = compareV3DraftRuns(JSON.parse(read(before, "generation.json")), JSON.parse(read(after, "generation.json")),
      read(before, "coverage.csv"), read(after, "coverage.csv"));
    const directory = resolveReviewOutput(catalogRoot, output);
    fs.mkdirSync(directory);
    const write = (file, data) => fs.writeFileSync(path.join(directory, file), data, { flag: "wx" });
    write("gap-diff.json", JSON.stringify(report, null, 2) + "\n");
    write("gap-groups.csv", csv([["field", "normalized", "occurrences", "cards", "resolved", "resolved_cards", "expressibility", "reason", "example_card", "example_raw"],
      ...report.groups.map(row => [row.field, row.pattern, row.spans, row.cards, row.resolved, row.resolvedCards, row.expressibility, row.reason, row.exampleCard, row.example])]));
    const columns = ["cardId", "before", "after", "compilerBefore", "compilerAfter", "coverageBefore", "coverageAfter", "unresolvedBefore", "unresolvedAfter",
      "definitionHashBefore", "definitionHashAfter", "reasonsBefore", "reasonsAfter"];
    write("card-diff.csv", csv([columns, ...report.cardChanges.map(row => columns.map(column =>
      Array.isArray(row[column]) ? JSON.stringify(row[column]) : row[column]))]));
    console.log(JSON.stringify({ before: report.before, after: report.after, coverageAfter: report.coverageAfter,
      groupCount: report.groups.length, improvements: report.improvements, approvedOverlap: report.approvedOverlap.length, regressions: report.regressions.length }));
    if (report.regressions.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
