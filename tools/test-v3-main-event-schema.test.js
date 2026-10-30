import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), { compileV3CardJson } = require("../server/dist/test/effects/v3/compiler.js");
const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
let Ajv;
try { Ajv = require("ajv/dist/2020"); } catch { /* Optional documentation validator, not a game dependency. */ }
const options = { skip: !Ajv ? "Set NODE_PATH to Ajv 8" : false };

test("schema19 accepts bounded simple MAIN and old profiles still reject it", options, () => {
  const schema = read("../schemas/effect-v3-subset19.schema.json"); assert.deepEqual(schema, read("../docs/card-effect-main-event.schema.json"));
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema), example = read("../docs/card-effect-main-event-examples.json").examples[0].card;
  for (const actions of [example.effects[0].actions, [{ type: "SEQUENCE", actions: example.effects[0].actions }]]) {
    const d = structuredClone(example); d.effects[0].actions = actions;
    assert.equal(validate(d), true, JSON.stringify(validate.errors)); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(d)));
  }
  for (const version of [16, 17, 18]) { const d = structuredClone(example); d.schemaVersion = `3.0.0-subset.${version}`; assert.throws(() => compileV3CardJson(JSON.stringify(d))); }
});

test("schema19 and Compiler reject unsupported MAIN work rather than auto-convert it", options, () => {
  const validate = new Ajv({ strict: false, allErrors: true }).compile(read("../schemas/effect-v3-subset19.schema.json"));
  const example = read("../docs/card-effect-main-event-examples.json").examples[0].card;
  for (const mutate of [d => { d.effects[0].optional = true; }, d => { d.effects[0].sourceZones = ["trash"]; },
    d => { d.effects[0].costs = [{ type: "REST_DON", count: 1 }]; }, d => { d.effects[0].actions = [{ type: "BIND_SOURCE", bindAs: "self" }]; },
    d => { d.effects[0].actions[0].player = "OPPONENT"; }, d => { d.effects[0].actions = [{ type: "SEQUENCE", actions: [] }]; },
    d => { d.effects[0].resolutionConditions = { type: "any", conditions: [] }; }]) {
    const d = structuredClone(example); mutate(d); assert.equal(validate(d), false); assert.throws(() => compileV3CardJson(JSON.stringify(d)));
  }
});
