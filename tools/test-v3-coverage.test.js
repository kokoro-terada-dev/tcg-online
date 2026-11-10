import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { analyzeV3Coverage, renderV3Coverage, writeV3Coverage } from "./analyze-v3-coverage.js";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { parseCsv } from "./build-card-master.js";

const require = createRequire(import.meta.url);
const { SOURCE_COLUMNS } = require("../server/dist/test/effects/v3/cardData.js");
const { loadReviewedV3Catalog } = require("../server/dist/test/effects/v3/reviewedCatalog.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const { registryHash } = require("../docs/card-effect-supported-operations.json");
const catalog = loadReviewedV3Catalog();
const root = fileURLToPath(new URL("../server/data/effects-v3-reviewed", import.meta.url));
const quotes = value => `"${String(value).replaceAll('"', '""')}"`;
const csv = rows => Buffer.from([SOURCE_COLUMNS, ...rows.map(row => SOURCE_COLUMNS.map(field => row[field] ?? ""))]
  .map(row => row.map(quotes).join(",")).join("\r\n"));
const row = (d, patch = {}) => ({
  "表示ID": d.source.displayIds[0], "カード番号": d.cardId, "カード名": d.name, "種類": d.cardType.toUpperCase(),
  "コスト": d.baseStats.cost ?? "-", "ライフ": d.baseStats.life ?? "-", "パワー": d.baseStats.power ?? "-", "カウンター": d.baseStats.counter ?? "-",
  "色": d.colors.join("/"), "属性": d.attributes.join("/"), "特徴": d.traits.join("/"),
  "テキスト": d.source.text || "-", "トリガー": d.source.triggerText || "-", ...patch
});
const draft = (id, text) => {
  const d = definition();
  d.cardId = id; d.source.displayIds = [id];
  if (text) d.source.text = text;
  return d;
};
const bundle = (ledger, drafts) => ({
  version: "v3-coverage-candidates.1", sourceCsvSha256: ledger.sourceSha256, registryHash,
  cards: drafts.map(([d, extra]) => ({ cardId: d.cardId, variantSha256: ledger.cards.find(card => card.cardId === d.cardId).variants[0].pairSha256,
    definition: d, ...extra }))
});
const byId = (report, id) => report.cards.find(card => card.cardId === id);

test("an existing approval covers only the pinned display IDs, not new or divergent variants", () => {
  const approved = catalog.catalog.get("ST02-001").definition;
  const rows = approved.source.displayIds.map(id => row(approved, { "表示ID": id }));
  const bytes = csv([...rows, row(approved, { "表示ID": "ANOTHER-PRINT" })]), ledger = ledgerFromCsv(bytes);
  const report = analyzeV3Coverage(catalog, bytes, { auditLedger: ledger });
  assert.equal(report.total, 1);
  assert.equal(report.reviewedMissingFromCsv, 13);
  assert.equal(report.counts.approved, 1);
  assert.deepEqual(report.cards[0].unapprovedDisplays, ["ANOTHER-PRINT"]);
  assert.equal(report.cards[0].approval.compiler, "verified_by_catalog");
  const conflict = analyzeV3Coverage(catalog, csv([...rows, row(approved, { "表示ID": "ANOTHER-PRINT", "テキスト": "違う原文" })]));
  assert.equal(conflict.cards[0].classification, "ruling");
  assert.equal(conflict.cards[0].approval.status, "approved");
  assert.equal(conflict.cards[0].approval.sourceConfirmed, false);
});

test("compiler success, source mismatch, errors, partial evidence and UNKNOWN are separate axes", () => {
  const pass = draft("DRAFT-OK"), fail = draft("DRAFT-FAIL"), mismatch = draft("DRAFT-MISMATCH");
  const partial = draft("DRAFT-PARTIAL", "カード1枚を引く。\r\nデッキをシャッフルする。");
  const unknown = draft("DRAFT-UNKNOWN"), undecided = draft("DRAFT-RULING");
  const bytes = csv([row(pass), row(fail), row(mismatch, { "カード名": "Source name differs" }), row(partial), row(unknown), row(undecided)]);
  const ledger = ledgerFromCsv(bytes);
  fail.effects[0].actions[0].count = -1;
  const finding = (kind, d) => ({ kind, feature: "unconfirmed-review", field: "text", quote: d.source.text, evidence: "Synthetic review note" });
  const candidates = bundle(ledger, [[pass], [fail], [mismatch], [partial, { supportedEvidence: "Only the DRAW clause is confirmed." }],
    [unknown, { findings: [finding("unknown", unknown)] }], [undecided, { findings: [finding("ruling", undecided)] }]]);
  const report = analyzeV3Coverage(catalog, bytes, { candidates });
  assert.equal(byId(report, "DRAFT-OK").classification, "candidate");
  assert.equal(byId(report, "DRAFT-OK").approval, null);
  assert.equal(byId(report, "DRAFT-OK").draft.runtime, "profile_compatible_not_executed");
  assert.equal(byId(report, "DRAFT-FAIL").draft.compiler, "failed");
  assert.equal(byId(report, "DRAFT-FAIL").classification, "unassessed");
  assert.equal(byId(report, "DRAFT-MISMATCH").draft.conversion, "source_mismatch");
  assert.equal(byId(report, "DRAFT-MISMATCH").classification, "unassessed");
  assert.equal(byId(report, "DRAFT-PARTIAL").classification, "partial");
  assert.equal(byId(report, "DRAFT-UNKNOWN").draft.compiler, "passed");
  assert.equal(byId(report, "DRAFT-UNKNOWN").classification, "unassessed");
  assert.equal(byId(report, "DRAFT-RULING").classification, "ruling");
});

test("literal probes count each feature once per card and leave generic text unclassified", () => {
  const missing = draft("MISSING", "デッキをシャッフルする。\r\nこのバトル終了時、カード1枚を引く。");
  const unknown = draft("NO-GUESS", "次の自分のターン開始時まで、パワー+1000。");
  const bytes = csv([row(missing), row(missing, { "表示ID": "ALT" }), row(unknown)]);
  const report = analyzeV3Coverage(catalog, bytes);
  assert.equal(byId(report, "MISSING").classification, "unsupported");
  assert.equal(byId(report, "NO-GUESS").classification, "unassessed");
  assert.deepEqual(report.gaps.map(gap => [gap.feature, gap.count]), [["battle-end-trigger", 1], ["effect-deck-shuffle", 1]]);
  const rendered = renderV3Coverage(report), [header, ...rows] = parseCsv(rendered.csv, { trim: false });
  const raw = JSON.parse(rows.find(row => row[0] === "MISSING")[header.indexOf("raw_variants")]);
  assert.equal(raw[0].text, missing.source.text);
  assert.deepEqual(raw[0].displayIds, ["MISSING", "ALT"]);
  assert.match(rendered.markdown, /効果によるデッキのシャッフル/);
  assert.ok(parseCsv(rendered.summaryCsv).some(row => row.join("/") === "unsupported_feature/effect-deck-shuffle/効果によるデッキのシャッフル/1"));
  assert.ok(!rendered.markdown.includes(missing.source.text));
});

test("stale or forged evidence is rejected and only a new report directory can be written", t => {
  const d = draft("TEST-SOURCE"), bytes = csv([row(d)]), ledger = ledgerFromCsv(bytes);
  const candidates = bundle(ledger, [[d]]);
  assert.throws(() => analyzeV3Coverage(catalog, bytes, { auditLedger: { ...ledger, rows: [] } }), /Audit ledger/);
  assert.throws(() => analyzeV3Coverage(catalog, bytes, { candidates: { ...candidates, sourceCsvSha256: "bad" } }), /SHA-256/);
  assert.throws(() => analyzeV3Coverage(catalog, bytes, { candidates: { ...candidates, registryHash: "old" } }), /Registry SHA-256/);
  const invalid = structuredClone(candidates);
  invalid.cards[0].findings = [{ kind: "unsupported", feature: "fake", field: "text", quote: "not in source", evidence: "fake" }];
  assert.throws(() => analyzeV3Coverage(catalog, bytes, { candidates: invalid }), /quote absent/);
  const base = fs.realpathSync(os.tmpdir()), temp = fs.mkdtempSync(path.join(base, "v3-coverage-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(temp)), base);
    assert.ok(path.basename(temp).startsWith("v3-coverage-"));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const output = path.join(temp, "report"), report = analyzeV3Coverage(catalog, bytes);
  assert.throws(() => writeV3Coverage(root, path.join(root, "report"), report), /outside/);
  writeV3Coverage(root, output, report);
  assert.deepEqual(fs.readdirSync(output).sort(), ["coverage.csv", "summary.csv", "summary.md"]);
  assert.throws(() => writeV3Coverage(root, output, report), { code: "EEXIST" });
});
