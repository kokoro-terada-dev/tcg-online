import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { conditionalTriggerSchema } from "./build-v3-trigger-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* Optional external validator. */ }
const options = { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" };
test("Schema21 copies derive from unchanged20 and expose candidate-only ON_EVENT", () => {
  const base = read("../schemas/effect-v3-subset20.schema.json"), before = structuredClone(base), next = conditionalTriggerSchema(base);
  assert.deepEqual(base, before); assert.deepEqual(next, read("../schemas/effect-v3-subset21.schema.json"));
  assert.deepEqual(next, read("../docs/card-effect-conditional-trigger.schema.json"));
});
test("Schema21 and Compiler accept conditional examples and reject malformed scopes", options, () => {
  const validate = new Ajv({ strict: false, allErrors: true }).compile(read("../schemas/effect-v3-subset21.schema.json"));
  for (const { card } of read("../docs/card-effect-conditional-trigger-examples.json").examples) {
    assert.equal(validate(card), true, JSON.stringify(validate.errors)); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(card)));
    for (const mutate of [d => { d.effects[0].timing.fromZones = []; }, d => { d.effects[0].timing.snapshot = "NOW"; },
      d => { d.effects[0].timing.owner = "BOTH"; }, d => { d.effects[0].kind = "activated"; },
      d => { d.effects[0].activationConditions.player = "BOTH"; }]) {
      const broken = structuredClone(card); mutate(broken); assert.equal(validate(broken), false); assert.throws(() => compileV3CardJson(JSON.stringify(broken)));
    }
  }
});
test("published profile21 inventory matches its real registries and labels detection-only timing", () => {
  const o = read("../docs/card-effect-supported-operations.json"), r = builtinV3Registries("3.0.0-subset.21");
  assert.equal(o.profiles["3.0.0-subset.21"].registryHash, v3RegistryHash(r));
  assert.deepEqual(o.profiles["3.0.0-subset.21"].registries, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.manifest()])));
  assert.equal(o.operations.find(op => op.name === "ON_EVENT").status, "candidate_detection_only");
  assert.deepEqual(o.operations.filter(op => op.availableIn.includes("3.0.0-subset.21")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
    Object.entries(r).flatMap(([k, v]) => v.manifest().map(item => `${k}:${item}`)).sort());
});
