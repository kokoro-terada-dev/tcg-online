import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { expirySchema } from "./build-v3-expiry-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External optional validator. */ }
test("Schema24 is reproducible, explicit, and never broadens old23 duration grammar", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset23.schema.json"), before = structuredClone(base), schema = expirySchema(base);
  assert.deepEqual(base, before); assert.deepEqual(schema, read("../schemas/effect-v3-subset24.schema.json")); assert.deepEqual(schema, read("../docs/card-effect-expiry.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema);
  const c = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card; c.schemaVersion = "3.0.0-subset.24";
  c.effects[0].actions = [{ type: "BIND_SOURCE", bindAs: "self" }, { type: "MODIFY_STAT", cards: { ref: "bindings.self" }, stat: "power", amount: 1000,
    duration: { type: "UNTIL_BOUNDARY", player: "OPPONENT", boundary: "END_PHASE_END", occurrence: 1, includeCurrent: false } }];
  assert.equal(validate(c), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(c)));
  const old = structuredClone(c); old.schemaVersion = "3.0.0-subset.23"; assert.throws(() => compileV3CardJson(JSON.stringify(old)));
  for (const change of [d => delete d.includeCurrent, d => { d.includeCurrent = null; }, d => { d.boundary = "UNKNOWN"; }, d => { d.occurrence = 0; }, d => { d.occurrence = 3; }, d => { d.player = "BOTH"; }]) {
    const invalid = structuredClone(c); change(invalid.effects[0].actions[1].duration); assert.equal(validate(invalid), false); assert.throws(() => compileV3CardJson(JSON.stringify(invalid)));
  }
});
test("new expiry handler inventory is exact and old23 hash is unchanged", () => {
  const r = builtinV3Registries("3.0.0-subset.24"), old = builtinV3Registries("3.0.0-subset.23"), o = read("../docs/card-effect-supported-operations.json");
  assert.equal(v3RegistryHash(old), "2a106a66a4e1d2547d57cc2ec65e39283d2fb4a722b6adbd4951b9f084d9bf04");
  assert.equal(o.profiles["3.0.0-subset.24"].registryHash, v3RegistryHash(r));
  assert.deepEqual(o.operations.filter(op => op.availableIn.includes("3.0.0-subset.24")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
    Object.entries(r).flatMap(([key, v]) => v.manifest().map(x => `${key}:${x}`)).sort());
  assert.deepEqual(r.duration.manifest(), [...old.duration.manifest(), "UNTIL_BOUNDARY@1"].sort());
});
