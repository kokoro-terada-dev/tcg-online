import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { ledgerFromCsv, writeReviewLedger } from "./build-v3-review-ledger.js";
const require = createRequire(import.meta.url);
const { SOURCE_COLUMNS } = require("../server/dist/test/effects/v3/cardData.js");
const { compileV3CardJson } = require("../server/dist/test/effects/v3/compiler.js");
const { ApprovedV3Catalog, isApprovedV3Card } = require("../server/dist/test/effects/v3/approval.js");
const { loadReviewedV3Catalog } = require("../server/dist/test/effects/v3/reviewedCatalog.js");
const { validateReviewedV3Deck } = require("../server/dist/test/effects/v3/reviewedDeck.js");
const { loadReviewedV3Preset } = require("../server/dist/test/effects/v3/reviewedPresets.js");
function csv(patches) {
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  return Buffer.from([SOURCE_COLUMNS, ...patches.map(patch => SOURCE_COLUMNS.map(field => ({
    "表示ID": "T-001", "カード番号": "T-001", "カード名": "Review fixture", "種類": "CHARACTER", "テキスト": "【登場時】カード1枚を引く。", ...patch,
  })[field] ?? ""))].map(row => row.map(quote).join(",")).join("\r\n"));
}
const hash = value => createHash("sha256").update(value).digest("hex");

test("ledger pins exact CSV bytes and all originals without selecting a canonical variant", () => {
  const bytes = csv([{ "テキスト": " 【ドン‼×1】\r\n効果  " }, { "表示ID": "T-001_p1", "テキスト": "【ドン!!×1】\n効果" }]);
  const ledger = ledgerFromCsv(bytes), card = ledger.cards[0];
  assert.equal(ledger.sourceSha256, hash(bytes)); assert.equal(ledger.rows[0].sourceSha256, hash(bytes));
  assert.equal(ledger.rows[0].raw["テキスト"], " 【ドン‼×1】\r\n効果  ");
  assert.equal(card.variants.length, 2); assert.equal(card.disposition, "quarantine");
  assert.equal(card.variants[0].pairSha256, hash(JSON.stringify([ledger.rows[0].raw["テキスト"], ""])));
  assert.deepEqual(card.variants.map(v => v.recordNumbers), [[2], [3]]);
  assert.equal(Object.hasOwn(card, "consensus"), false); assert.equal(card.reviewStatus, "needs_review");
  assert.equal(Object.isFrozen(ledger.rows[0].raw), true); assert.equal(Object.isFrozen(card.variants[0].displayIds), true);
});

test("generic quarantine retains invalid type, missing payment variants and trigger/body anomalies", () => {
  const ledger = ledgerFromCsv(csv([
    { "表示ID": "P-160", "カード番号": "P-160", "種類": "キャラクタークター" },
    { "表示ID": "ST30-012", "カード番号": "ST30-012", "テキスト": "【登場時】自分のドン!!枚をレストにできる：処理。" },
    { "表示ID": "ST30-012_p2", "カード番号": "ST30-012", "テキスト": "【登場時】自分のドン!!1枚をレストにできる：処理。" },
    { "表示ID": "OP06-101", "カード番号": "OP06-101", "トリガー": "【トリガー】処理。" },
    { "表示ID": "OP06-101_p3", "カード番号": "OP06-101", "テキスト": "【登場時】カード1枚を引く。【トリガー】処理。" },
    { "表示ID": "OTHER", "カード番号": "OTHER", "テキスト": "【メイン】処理。\n【トリガー】処理。" },
  ]));
  assert.equal(ledger.cards.every(card => card.disposition === "quarantine"), true);
  assert.ok(ledger.cards[0].reasons.includes("invalid-card-type"));
  assert.equal(ledger.cards[1].variants.length, 2); assert.equal(ledger.cards[2].variants.length, 2);
  assert.ok(ledger.cards[3].reasons.includes("trigger-clause-in-body-needs-review"));
  assert.equal(ledger.rows[1].raw["テキスト"].includes("ドン!!枚"), true);
});

test("even clean review rows and forged approved flags cannot enter the executable catalog", () => {
  const ledger = ledgerFromCsv(csv([{}]));
  assert.equal(ledger.cards[0].disposition, "review_required"); assert.equal(ledger.executable, false);
  for (const entry of [ledger, ledger.cards[0], { ...ledger.cards[0], reviewStatus: "approved", executable: true }]) {
    assert.equal(isApprovedV3Card(entry), false);
    assert.throws(() => compileV3CardJson(JSON.stringify(entry)));
    assert.throws(() => new ApprovedV3Catalog([entry], [], "synthetic.1"));
  }
  const loaded = loadReviewedV3Catalog(), { deck } = loadReviewedV3Preset("kid-basic");
  const bad = structuredClone(deck); bad.mainDeck[0] = "T-001"; bad.cardTypes["T-001"] = "character";
  assert.throws(() => validateReviewedV3Deck(bad, loaded.catalog)); assert.equal(loaded.cards.length, 14);
});

test("CLI output is review only, reproduces source bytes and refuses overwrite without editing manifests", t => {
  const tempRoot = fs.realpathSync(os.tmpdir()), temp = fs.mkdtempSync(path.join(tempRoot, "v3-ledger-"));
  t.after(() => { const target = fs.realpathSync(temp); assert.equal(path.dirname(target), tempRoot); assert.ok(path.basename(target).startsWith("v3-ledger-")); fs.rmSync(target, { recursive: true, force: true }); });
  const input = path.join(temp, "input.csv"), out = path.join(temp, "out"), bytes = csv([{}]); fs.writeFileSync(input, bytes);
  const manifest = new URL("../server/data/effects-v3-reviewed/manifest.json", import.meta.url), before = fs.readFileSync(manifest);
  const result = writeReviewLedger(input, out); assert.equal(result.approved, 0);
  assert.deepEqual(fs.readFileSync(path.join(out, "source.csv")), bytes); assert.deepEqual(fs.readFileSync(input), bytes);
  assert.throws(() => writeReviewLedger(input, out)); assert.deepEqual(fs.readFileSync(manifest), before);
  assert.throws(() => ledgerFromCsv(Buffer.from([0xff]))); assert.throws(() => ledgerFromCsv(csv([{}]).subarray(0, 20)));
});
