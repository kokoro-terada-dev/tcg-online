import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { rememberedFactsSchema } from "./build-v3-remembered-facts-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }
test("Schema26 is reproducible; explicit snapshot, basis and supported field match Compiler", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const old = read("../schemas/effect-v3-subset25.schema.json"), copy = structuredClone(old), schema = rememberedFactsSchema(old);
  assert.deepEqual(old, copy); assert.deepEqual(schema, read("../schemas/effect-v3-subset26.schema.json")); assert.deepEqual(schema, read("../docs/card-effect-remembered-facts.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), c = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  c.schemaVersion = "3.0.0-subset.26"; c.effects[0].actions = [{ type: "BIND_SOURCE", bindAs: "self" },
    { type: "MOVE_CARD", cards: { ref: "bindings.self" }, destination: { owner: "SELF", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT" }, { type: "MOVE_RESULT", bindAs: "returned" },
    { type: "REMEMBER_FACTS", result: "returned", cards: { ref: "bindings.self" }, snapshot: "BEFORE", basis: "PRINTED", field: "colors", bindAs: "colors" },
    { type: "IF", condition: { type: "REMEMBERED_COLORS", memory: "colors", subject: "SOURCE", basis: "CURRENT", match: "OVERLAP" }, then: [{ type: "DRAW", player: "SELF", count: 1 }], else: [] }];
  assert.equal(validate(c), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(c)));
  const all = structuredClone(c); all.effects[0].actions[3].cards = null; assert.equal(validate(all), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(all)));
  for (const mutate of [r => delete r.effects[0].actions[3].snapshot, r => { r.effects[0].actions[3].snapshot = "LATEST"; }, r => { r.effects[0].actions[3].basis = "UNKNOWN"; },
    r => { r.effects[0].actions[3].field = "power"; }, r => { r.effects[0].actions[3].cards = { index: 0 }; }, r => { r.effects[0].actions[3].bindAs = "__proto__"; },
    r => { r.effects[0].actions[4].condition.match = "ANY"; }, r => { r.effects[0].actions[4].condition.extra = true; }]) {
    const invalid = structuredClone(c); mutate(invalid); assert.equal(validate(invalid), false); assert.throws(() => compileV3CardJson(JSON.stringify(invalid)));
  }
  const prior = structuredClone(c); prior.schemaVersion = "3.0.0-subset.25"; assert.throws(() => compileV3CardJson(JSON.stringify(prior)));
});
test("inventory advertises only implemented handlers and retains every prior Registry hash", () => {
  const data = read("../docs/card-effect-supported-operations.json"), r = builtinV3Registries("3.0.0-subset.26");
  assert.equal(data.profiles["3.0.0-subset.26"].registryHash, v3RegistryHash(r));
  for (let n = 16; n <= 25; n++) assert.equal(data.profiles[`3.0.0-subset.${n}`].registryHash, v3RegistryHash(builtinV3Registries(`3.0.0-subset.${n}`)));
  assert.deepEqual(data.operations.filter(op => op.availableIn.includes("3.0.0-subset.26")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(), Object.entries(r).flatMap(([key, reg]) => reg.manifest().map(entry => `${key}:${entry}`)).sort());
});
