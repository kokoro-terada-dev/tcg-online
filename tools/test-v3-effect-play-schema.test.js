import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { effectPlaySchema } from "./build-v3-effect-play-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }
test("Schema27 is reproducible and shares effect-play structure with Compiler", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset26.schema.json"), copy = structuredClone(base), schema = effectPlaySchema(base);
  assert.deepEqual(base, copy); assert.deepEqual(schema, read("../schemas/effect-v3-subset27.schema.json")); assert.deepEqual(schema, read("../docs/card-effect-effect-play.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), c = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  c.schemaVersion = "3.0.0-subset.27"; c.effects[0].actions = [{ type: "SELECT", bindAs: "chosen", selector: { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone: "hand", cardTypes: ["character"], visibility: "OWNER_ONLY", faceUpOnly: false,
    excludeSource: false, min: 0, max: 1, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail", filters: { type: "all", conditions: [] } } },
    { type: "PLAY_BY_EFFECT", cards: { ref: "bindings.chosen" }, from: "hand", destination: { owner: "SELF", zone: "character", slotPolicy: "FIRST_EMPTY" }, enterState: "REST", provenance: "EFFECT", condition: { type: "all", conditions: [] } },
    { type: "MOVE_RESULT", bindAs: "played" }];
  assert.equal(validate(c), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(c)));
  for (const change of [a => delete a.condition, a => { a.from = "deck"; }, a => { a.destination.owner = "OPPONENT"; }, a => { a.destination.slotPolicy = "REPLACE"; },
    a => { a.destination.zone = "stage"; }, a => { a.enterState = "UNKNOWN"; }, a => { a.payCost = false; }, a => { a.provenance = "NORMAL_PLAY"; }]) {
    const bad = structuredClone(c); change(bad.effects[0].actions[1]); assert.equal(validate(bad), false); assert.throws(() => compileV3CardJson(JSON.stringify(bad)));
  }
  const old = structuredClone(c); old.schemaVersion = "3.0.0-subset.26"; assert.throws(() => compileV3CardJson(JSON.stringify(old)));
});
test("Registry27 inventory is exact and old16-26 hashes are unchanged", () => {
  const data = read("../docs/card-effect-supported-operations.json"), r = builtinV3Registries("3.0.0-subset.27");
  assert.equal(data.profiles["3.0.0-subset.27"].registryHash, v3RegistryHash(r));
  for (let n = 16; n <= 26; n++) assert.equal(data.profiles[`3.0.0-subset.${n}`].registryHash, v3RegistryHash(builtinV3Registries(`3.0.0-subset.${n}`)));
  assert.deepEqual(data.operations.filter(op => op.availableIn.includes("3.0.0-subset.27")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(), Object.entries(r).flatMap(([key, reg]) => reg.manifest().map(x => `${key}:${x}`)).sort());
});
