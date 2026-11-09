import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { donEffectsSchema } from "./build-v3-don-effects-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }
test("DON Schema28 is reproducible and agrees with the Compiler", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset27.schema.json"), copy = structuredClone(base), schema = donEffectsSchema(base);
  assert.deepEqual(base, copy);
  assert.deepEqual(schema, read("../schemas/effect-v3-subset28.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-don-effects.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  card.schemaVersion = "3.0.0-subset.28"; card.effects[0].actions = [
    { type: "SELECT", bindAs: "don", selector: { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone: ["restDon"], cardTypes: ["don"], visibility: "PUBLIC", faceUpOnly: true, excludeSource: false,
      min: 0, max: 2, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail", filters: { type: "all", conditions: [] } } },
    { type: "SET_DON_STATE", cards: { ref: "bindings.don" }, from: "REST", to: "ACTIVE" },
    { type: "ADD_DON", player: "SELF", count: 1, state: "REST", onInsufficient: "fail" }
  ];
  assert.equal(validate(card), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(card)));
  for (const mutate of [
    actions => { actions[1].to = "REST"; }, actions => { actions[1].from = "ATTACHED"; },
    actions => { actions[2].count = 11; }, actions => { actions[2].player = "OPPONENT"; },
    actions => { actions[2].onInsufficient = "takeAvailable"; }, actions => { actions[2].destination = "character"; }
  ]) { const invalid = structuredClone(card); mutate(invalid.effects[0].actions); assert.equal(validate(invalid), false); assert.throws(() => compileV3CardJson(JSON.stringify(invalid))); }
});
test("Registry28 contains the exact implemented inventory and preserves all old hashes", () => {
  const data = read("../docs/card-effect-supported-operations.json"), r = builtinV3Registries("3.0.0-subset.28");
  assert.equal(data.profiles["3.0.0-subset.28"].registryHash, v3RegistryHash(r));
  for (let n = 16; n <= 27; n++) assert.equal(data.profiles[`3.0.0-subset.${n}`].registryHash, v3RegistryHash(builtinV3Registries(`3.0.0-subset.${n}`)));
  assert.deepEqual(data.operations.filter(op => op.availableIn.includes("3.0.0-subset.28")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
    Object.entries(r).flatMap(([key, reg]) => reg.manifest().map(x => `${key}:${x}`)).sort());
});
