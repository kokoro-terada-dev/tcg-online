import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { boundarySchema } from "./build-v3-boundary-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External optional validator. */ }
test("Schema23 is reproducible; each new timing validates and old22 rejects it", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset22.schema.json"), before = structuredClone(base), schema = boundarySchema(base);
  assert.deepEqual(base, before); assert.deepEqual(schema, read("../schemas/effect-v3-subset23.schema.json")); assert.deepEqual(schema, read("../docs/card-effect-boundary.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema);
  for (const type of ["ON_BLOCK", "MAIN_START", "TURN_END"]) {
    const c = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card; c.schemaVersion = "3.0.0-subset.23";
    if (type === "ON_BLOCK") { c.cardType = "character"; c.baseStats = { cost: 2, power: 2000, counter: 1000, life: null }; }
    c.effects[0].sourceZones = [c.cardType]; c.effects[0].timing = { type, ...(type === "ON_BLOCK" ? {} : { player: "SELF" }) };
    assert.equal(validate(c), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(c)));
    const old = structuredClone(c); old.schemaVersion = "3.0.0-subset.22"; assert.throws(() => compileV3CardJson(JSON.stringify(old)));
    const bad = structuredClone(c); bad.effects[0].timing = { type: "TURN_START", player: "SELF" }; assert.equal(validate(bad), false); assert.throws(() => compileV3CardJson(JSON.stringify(bad)));
    if (type === "ON_BLOCK") { c.cardType = "leader"; c.effects[0].sourceZones = ["leader"]; assert.equal(validate(c), false); assert.throws(() => compileV3CardJson(JSON.stringify(c))); }
  }
});
test("Registry23 inventory is exact and old22 hash/duration vocabulary are unchanged", () => {
  const r = builtinV3Registries("3.0.0-subset.23"), old = builtinV3Registries("3.0.0-subset.22"), o = read("../docs/card-effect-supported-operations.json");
  assert.equal(v3RegistryHash(old), "97e2b8f51421bba99ad1c802f7820275f9dccfa013231a62f05919b3298d74e1"); assert.deepEqual(r.duration.manifest(), old.duration.manifest());
  assert.equal(o.profiles["3.0.0-subset.23"].registryHash, v3RegistryHash(r));
  assert.deepEqual(o.operations.filter(op => op.availableIn.includes("3.0.0-subset.23")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
    Object.entries(r).flatMap(([key, v]) => v.manifest().map(x => `${key}:${x}`)).sort());
});
