import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileMaster, parseCsv, buildMaster, prepareExpandedInput } from "./build-card-master.js";

const header = "id,type,cost,power,counter,effects,name,colors,attributes,traits,life,effectIds\n";
const csv = header + 'TEST-001,character,0,5000,1000,onPlay,"Test, card",red|green,strike,crew,,\n';
test("old CSV, blank/null, zero and new columns remain distinct", () => {
  const old = compileMaster("id,type,cost,power,counter,effects\nTEST-001,character,0,5000,NULL,onAttack");
  assert.equal(old.cards["TEST-001"].counter, null);
  assert.equal(old.cards["TEST-001"].cost, 0);
  const next = compileMaster(csv);
  assert.equal(next.cards["TEST-001"].name, "Test, card");
  assert.deepEqual(next.cards["TEST-001"].colors, ["red", "green"]);
  assert.equal(next.contentHash, compileMaster(csv).contentHash);
});
test("CSV handles BOM, multiline text and escaped quotes; rejects damaged structure", () => {
  assert.deepEqual(parseCsv('\uFEFFid,text\r\nA,"line1\nline2 ""quoted"""'), [["id", "text"], ["A", 'line1\nline2 "quoted"']]);
  assert.throws(() => parseCsv('id\n"unfinished'));
  assert.throws(() => compileMaster("id,type,cost,power,counter\nA,character,1"));
  assert.throws(() => compileMaster("id,id,type,cost,power,counter\nA,A,character,1,2,3"));
});
test("effects link automatically, cannot masquerade as executable", () => {
  const effects = 'effectId,cardId,timing,displayText,implementation\nTEST-001.play,TEST-001,onPlay,"Draw, then choose",unsupported';
  const master = compileMaster(csv, effects);
  assert.deepEqual(master.cards["TEST-001"].effectIds, ["TEST-001.play"]);
  assert.throws(() => compileMaster(csv, effects.replace("unsupported", "automatic")));
  assert.throws(() => compileMaster(csv, effects.replace(",TEST-001,", ",MISSING,")));
  assert.throws(() => compileMaster(csv.replace("crew,,", "crew,,missing")));
});
test("duplicates, invalid enums, fractions, negatives and unsafe integers fail", () => {
  assert.throws(() => compileMaster(csv + csv.split("\n")[1]));
  for (const value of ["-1", "1.5", "oops", "9007199254740992"]) assert.throws(() => compileMaster(csv.replace(",0,", `,${value},`)));
  assert.throws(() => compileMaster(csv.replace("character", "charactre")));
});
test("failed conversion preserves previous JSON byte-for-byte", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tcg-master-"));
  try {
    fs.mkdirSync(path.join(root, "local-data")); fs.mkdirSync(path.join(root, "public"));
    fs.writeFileSync(path.join(root, "public/card-master.json"), "previous");
    fs.writeFileSync(path.join(root, "local-data/card-master.csv"), "bad");
    assert.throws(() => buildMaster(root));
    assert.equal(fs.readFileSync(path.join(root, "public/card-master.json"), "utf8"), "previous");
    fs.writeFileSync(path.join(root, "local-data/card-master.csv"), csv);
    const master = buildMaster(root);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "public/card-master.json"))).contentHash, master.contentHash);
    prepareExpandedInput(root);
    const expanded = fs.readFileSync(path.join(root, "local-data/card-master-expanded.csv"), "utf8");
    assert.deepEqual(compileMaster(expanded).cards, compileMaster(csv).cards);
    assert.throws(() => prepareExpandedInput(root));
    assert.equal(fs.readFileSync(path.join(root, "local-data/card-master.csv"), "utf8"), csv);
  } finally { fs.rmSync(root, { recursive: true }); }
});
