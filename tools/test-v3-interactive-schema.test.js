import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { interactiveEventSchema } from "./build-v3-event-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson } = require("../server/dist/test/effects/v3/compiler.js");
const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* Optional validation dependency. */ }
const options = { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" };

test("Schema20 copies are reproducible from fixed Schema19 without changing the base", () => {
  const base = read("../schemas/effect-v3-subset19.schema.json"), before = structuredClone(base), result = interactiveEventSchema(base);
  assert.deepEqual(base, before); assert.deepEqual(result, read("../schemas/effect-v3-subset20.schema.json"));
  assert.deepEqual(result, read("../docs/card-effect-interactive-event.schema.json"));
});
test("Schema20 and Compiler accept public/private selections and reject broadening old19", options, () => {
  const ajv = new Ajv({ strict: false, allErrors: true }), validate = ajv.compile(read("../schemas/effect-v3-subset20.schema.json"));
  for (const { card } of read("../docs/card-effect-interactive-event-examples.json").examples) {
    assert.equal(validate(card), true, JSON.stringify(validate.errors)); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(card)));
    const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.19"; assert.throws(() => compileV3CardJson(JSON.stringify(old)));
  }
});
test("unimplemented selection scopes, source movement, battle duration and extra costs are rejected", options, () => {
  const validate = new Ajv({ strict: false, allErrors: true }).compile(read("../schemas/effect-v3-subset20.schema.json"));
  const base = read("../docs/card-effect-interactive-event-examples.json").examples[0].card;
  for (const mutate of [d => { d.effects[0].costs = [{ type: "REST_DON", count: 1 }]; }, d => { d.effects[0].actions[0].selector.zone = "trash"; },
    d => { d.effects[0].actions = [{ type: "BIND_SOURCE", bindAs: "source" }]; },
    d => { d.effects[0].actions[1].then = [{ type: "MODIFY_STAT", cards: { ref: "bindings.target" }, stat: "power", amount: 1000, duration: { type: "BATTLE_END" } }]; }]) {
    const card = structuredClone(base); mutate(card); assert.equal(validate(card), false); assert.throws(() => compileV3CardJson(JSON.stringify(card)));
  }
  const source = structuredClone(base); source.effects[0].actions[0].selector.filters = { type: "CARD_NAME", subject: "SOURCE", basis: "PRINTED", op: "eq", value: "x" };
  assert.throws(() => compileV3CardJson(JSON.stringify(source))); // Contextual restriction, not a JSON Schema claim.
});
